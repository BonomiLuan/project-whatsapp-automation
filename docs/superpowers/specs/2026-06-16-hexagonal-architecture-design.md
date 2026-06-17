# Hexagonal Architecture — Plataforma de Afiliados

**Data:** 2026-06-16  
**Status:** Aprovado

## Contexto

O projeto começou como um bot de afiliados para WhatsApp/Telegram e cresceu para incluir scraping de Pelando e Mercado Livre, coupons, link shortener, e integração com múltiplos marketplaces. O objetivo agora é evoluir para uma **plataforma SaaS multi-tenant** com frontend de configuração e suporte a múltiplos clientes.

Problemas atuais:
- `telegram/bot.ts` → 1129 linhas (comandos, monitores, formatadores misturados)
- `server/index.ts` → 661 linhas (Express + cron + rotas + lógica de negócio)
- `content/pelando.ts` → 665 linhas (scraping + monitoramento + formatação)
- Responsabilidades misturadas em toda a base de código
- Impossível adicionar novo marketplace sem mexer em arquivos não relacionados

## Arquitetura: Hexagonal (Ports & Adapters)

```
┌─────────────────────────────────────────────┐
│  ADAPTERS (infra)                           │
│  ┌───────────────────────────────────┐      │
│  │  APPLICATION (use cases)          │      │
│  │  ┌─────────────────────────┐      │      │
│  │  │  CORE DOMAIN            │      │      │
│  │  │  Deal, Tenant,          │      │      │
│  │  │  BotConfig, Filter      │      │      │
│  │  └─────────────────────────┘      │      │
│  │  MonitorDeals, PublishDeal,       │      │
│  │  FilterByKeyword, ManageTenant    │      │
│  └───────────────────────────────────┘      │
│  Scrapers, Publishers, DB, HTTP, Crons      │
└─────────────────────────────────────────────┘
```

**Regra:** dependências apontam sempre para dentro. O core nunca importa adapters.

## Estrutura de Pastas Target

```
src/
├── core/
│   ├── domain/
│   │   ├── Deal.ts
│   │   ├── Tenant.ts
│   │   └── Filter.ts
│   ├── ports/
│   │   ├── DealScraper.ts
│   │   ├── DealPublisher.ts
│   │   ├── DealRepository.ts
│   │   └── TenantRepository.ts
│   └── usecases/
│       ├── MonitorDeals.ts
│       ├── FilterDeals.ts
│       └── ManageTenant.ts
│
├── adapters/
│   ├── scrapers/
│   │   ├── PelandoScraper.ts
│   │   └── MercadoLivreScraper.ts
│   ├── publishers/
│   │   ├── TelegramPublisher.ts
│   │   └── WhatsAppPublisher.ts
│   ├── affiliates/
│   │   ├── AmazonAffiliate.ts
│   │   ├── MLAffiliate.ts
│   │   └── ShopeeAffiliate.ts
│   └── db/
│       ├── PgDealRepository.ts
│       └── PgTenantRepository.ts
│
├── web/
│   ├── server.ts
│   ├── middleware/
│   └── routes/
│       ├── api/
│       │   ├── tenants.ts
│       │   ├── config.ts
│       │   └── deals.ts
│       └── redirect/
│           └── links.ts
│
├── jobs/
│   ├── cronLock.ts
│   ├── monitorPelando.ts
│   └── monitorML.ts
│
└── index.ts
```

## Core Domain

### Entidades

```typescript
// core/domain/Deal.ts
type Marketplace = 'pelando' | 'mercadolivre' | 'shopee' | 'amazon'

type Deal = {
  id: string
  title: string
  price: number
  originalPrice?: number
  url: string
  imageUrl?: string
  couponCode?: string
  marketplace: Marketplace
  category: string
  postedAt: Date
}

// core/domain/Filter.ts
type Filter = {
  keywords: string[]
  excludeKeywords: string[]
  minDiscount: number
  categories: string[]
}

// core/domain/Tenant.ts
type Channel = {
  type: 'telegram' | 'whatsapp'
  channelId: string
}

type AffiliateConfig = {
  amazonTag?: string
  mlAppId?: string
  shopeeSourceId?: string
}

type Tenant = {
  id: string
  name: string
  channels: Channel[]
  filters: Filter
  affiliates: AffiliateConfig
  active: boolean
}
```

### Ports (Interfaces)

```typescript
// core/ports/DealScraper.ts
interface DealScraper {
  fetchDeals(category?: string): Promise<Deal[]>
}

// core/ports/DealPublisher.ts
interface DealPublisher {
  publish(deal: Deal, tenant: Tenant): Promise<void>
}

// core/ports/DealRepository.ts
interface DealRepository {
  findSentIds(): Promise<Set<string>>
  markAsSent(dealId: string, tenantId: string): Promise<void>
}

// core/ports/TenantRepository.ts
interface TenantRepository {
  findAll(): Promise<Tenant[]>
  findById(id: string): Promise<Tenant | null>
  save(tenant: Tenant): Promise<void>
}
```

### Use Case Principal

```typescript
// core/usecases/MonitorDeals.ts
class MonitorDeals {
  constructor(
    private scraper: DealScraper,
    private publisher: DealPublisher,
    private dealRepo: DealRepository,
    private tenantRepo: TenantRepository,
    private filterDeals: FilterDeals,
  ) {}

  async execute() {
    const deals = await this.scraper.fetchDeals()
    const tenants = await this.tenantRepo.findAll()
    const sentIds = await this.dealRepo.findSentIds()

    for (const tenant of tenants) {
      const filtered = this.filterDeals.execute(deals, tenant.filters, sentIds)
      for (const deal of filtered) {
        await this.publisher.publish(deal, tenant)
        await this.dealRepo.markAsSent(deal.id, tenant.id)
      }
    }
  }
}
```

## Multi-tenancy

### Schema de Banco de Dados

```sql
CREATE TABLE tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE tenant_channels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id),
  type TEXT NOT NULL, -- 'telegram' | 'whatsapp'
  channel_id TEXT NOT NULL
);

CREATE TABLE tenant_filters (
  tenant_id UUID PRIMARY KEY REFERENCES tenants(id),
  keywords TEXT[] DEFAULT '{}',
  exclude_keywords TEXT[] DEFAULT '{}',
  min_discount INTEGER DEFAULT 0,
  categories TEXT[] DEFAULT '{}'
);

CREATE TABLE tenant_affiliates (
  tenant_id UUID PRIMARY KEY REFERENCES tenants(id),
  amazon_tag TEXT,
  ml_app_id TEXT,
  shopee_source_id TEXT
);
```

### REST API (para o futuro frontend)

```
GET    /api/tenants              → lista todos os tenants
POST   /api/tenants              → cria tenant
GET    /api/tenants/:id          → detalhe do tenant
PUT    /api/tenants/:id/config   → atualiza filtros/keywords
GET    /api/deals?tenant_id=x   → histórico de deals enviados
```

## Estratégia de Migração (3 Fases)

### Fase 1 — Reorganização Estrutural (sem mudar comportamento)

Mover código existente para a nova estrutura de pastas. Zero mudança de comportamento. Cada passo é um commit deployável.

**Baby steps:**
1. Criar pastas: `core/`, `adapters/`, `jobs/`, `web/`
2. Mover `src/api/amazonAffiliate.ts` → `adapters/affiliates/AmazonAffiliate.ts`
3. Mover `src/api/mercadoLivreAffiliate.ts` → `adapters/affiliates/MLAffiliate.ts`
4. Mover `src/api/shopeeAffiliate.ts` → `adapters/affiliates/ShopeeAffiliate.ts`
5. Mover `src/api/metaClient.ts` → `adapters/publishers/WhatsAppPublisher.ts`
6. Mover `src/server/links.ts` → `adapters/db/LinksRepository.ts`
7. Mover `src/server/history.ts` → `adapters/db/HistoryRepository.ts`
8. Mover `src/scraper/productScraper.ts` → `adapters/scrapers/ProductScraper.ts`
9. Dividir `content/pelando.ts` → `adapters/scrapers/PelandoScraper.ts` + `jobs/monitorPelando.ts`
10. Dividir `content/mercadoLivre.ts` → `adapters/scrapers/MercadoLivreScraper.ts` + `jobs/monitorML.ts`
11. Dividir `telegram/bot.ts` → `adapters/publishers/TelegramPublisher.ts` + `adapters/telegram/commands/`
12. Dividir `server/index.ts` → `web/server.ts` + `web/routes/` + `jobs/` + `index.ts`

### Fase 2 — Extrair Core + Ports

Definir interfaces, criar entidades, fazer adapters implementar ports.

**Baby steps:**
1. Criar `core/domain/Deal.ts` com type Deal
2. Criar `core/domain/Tenant.ts` com type Tenant (tenant único = configuração atual)
3. Criar `core/domain/Filter.ts`
4. Criar `core/ports/DealScraper.ts`
5. Criar `core/ports/DealPublisher.ts`
6. Criar `core/ports/DealRepository.ts`
7. Fazer `PelandoScraper` implementar `DealScraper`
8. Fazer `MercadoLivreScraper` implementar `DealScraper`
9. Fazer `TelegramPublisher` implementar `DealPublisher`
10. Extrair `core/usecases/FilterDeals.ts`
11. Extrair `core/usecases/MonitorDeals.ts`
12. Atualizar `index.ts` com injeção de dependência

### Fase 3 — Multi-tenancy

Adicionar suporte a múltiplos tenants no banco e expor API REST.

**Baby steps:**
1. Criar migrations: `tenants`, `tenant_channels`, `tenant_filters`, `tenant_affiliates`
2. Criar `core/ports/TenantRepository.ts`
3. Criar `adapters/db/PgTenantRepository.ts`
4. Migrar tenant único atual para a nova tabela (seeding)
5. Adaptar `MonitorDeals` para iterar por tenant
6. Criar `core/usecases/ManageTenant.ts`
7. Criar `web/routes/api/tenants.ts`
8. Criar `web/routes/api/config.ts`
9. Criar `web/routes/api/deals.ts`

## Ponto de Composição (index.ts)

```typescript
// src/index.ts
import { Pool } from 'pg'
import { Telegraf } from 'telegraf'
import { PgTenantRepository } from './adapters/db/PgTenantRepository.js'
import { PgDealRepository } from './adapters/db/PgDealRepository.js'
import { PelandoScraper } from './adapters/scrapers/PelandoScraper.js'
import { TelegramPublisher } from './adapters/publishers/TelegramPublisher.js'
import { FilterDeals } from './core/usecases/FilterDeals.js'
import { MonitorDeals } from './core/usecases/MonitorDeals.js'

const db = new Pool({ connectionString: process.env.DATABASE_URL })
const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN!)

const tenantRepo = new PgTenantRepository(db)
const dealRepo = new PgDealRepository(db)
const pelandoScraper = new PelandoScraper()
const telegramPublisher = new TelegramPublisher(bot)
const filterDeals = new FilterDeals()

const monitorDeals = new MonitorDeals(
  pelandoScraper, telegramPublisher, dealRepo, tenantRepo, filterDeals
)
```

## Princípios de Implementação

- **Cada baby step é um commit deployável** — nunca quebra produção
- **Fase 1 não muda comportamento** — só move arquivos e atualiza imports
- **Fase 2 pode ser feita arquivo por arquivo** — um port por vez
- **Fase 3 é aditiva** — multi-tenancy começa com tenant único migrado
- **Sem frameworks de DI** — injeção manual no `index.ts` é suficiente para o tamanho atual
