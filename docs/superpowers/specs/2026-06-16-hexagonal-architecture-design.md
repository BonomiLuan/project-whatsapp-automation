# Hexagonal Architecture — Plataforma de Afiliados

**Data:** 2026-06-16  
**Status:** Em revisão

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
│  │  │  Deal, Tenant, Filter   │      │      │
│  │  └─────────────────────────┘      │      │
│  │  MonitorDeals, SuggestDeals,      │      │
│  │  FilterDeals, RecordFeedback,     │      │
│  │  ManageTenant                     │      │
│  └───────────────────────────────────┘      │
│  Scrapers, Publishers, Affiliates,          │
│  DB, HTTP, Crons                            │
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
│   │   ├── AffiliateLinkBuilder.ts
│   │   ├── DealRepository.ts
│   │   ├── TenantRepository.ts
│   │   ├── LinkResolver.ts
│   │   ├── RotationStore.ts
│   │   ├── FeedbackRepository.ts
│   │   ├── Scheduler.ts
│   │   └── Lock.ts
│   └── usecases/
│       ├── MonitorDeals.ts
│       ├── FilterDeals.ts
│       ├── SuggestDeals.ts
│       ├── AffiliateLinker.ts
│       ├── RecordFeedback.ts
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
│   ├── db/
│   │   ├── PgDealRepository.ts
│   │   ├── PgLinkRepository.ts
│   │   └── PgTenantRepository.ts
│   ├── lock/
│   │   └── PgAdvisoryLock.ts
│   └── scheduler/
│       └── NodeCronScheduler.ts
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

// core/ports/AffiliateLinkBuilder.ts
// O coração da monetização: reescreve a URL crua do deal com a tag de afiliado
// do tenant. Hoje vive solto em amazonAffiliate.ts / mlAffiliate.ts / shopeeAffiliate.ts.
// Um builder por marketplace; o use case escolhe pelo deal.marketplace.
interface AffiliateLinkBuilder {
  supports(marketplace: Marketplace): boolean
  build(deal: Deal, config: AffiliateConfig): Promise<Deal> // devolve o deal com url de afiliado
}

// core/ports/DealRepository.ts
// Dedupe é por janela temporal: hoje o código usa um Set in-memory
// (`sentToday`, resetado à meia-noite) + persistência no PG com janela de 7 dias
// (`recordDealSent` / `getExcludedDealIds`). O port unifica os dois.
interface DealRepository {
  findRecentlySentIds(tenantId: string, withinDays: number): Promise<Set<string>>
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
    private affiliate: AffiliateLinker,   // composite dos AffiliateLinkBuilder
    private dealRepo: DealRepository,
    private tenantRepo: TenantRepository,
    private filterDeals: FilterDeals,
  ) {}

  async execute() {
    const deals = await this.scraper.fetchDeals()
    const tenants = await this.tenantRepo.findAll()

    for (const tenant of tenants.filter(t => t.active)) {
      const sentIds = await this.dealRepo.findRecentlySentIds(tenant.id, 7)
      const filtered = this.filterDeals.execute(deals, tenant.filters, sentIds)
      for (const deal of filtered) {
        // Isolamento: um deal/tenant que falha não derruba o lote inteiro
        try {
          const linked = await this.affiliate.build(deal, tenant.affiliates)
          await this.publisher.publish(linked, tenant)
          // markAsSent DEPOIS do publish → at-least-once: preferimos pular um
          // deal a duplicá-lo pro usuário (duplicata é o pior erro num bot de ofertas)
          await this.dealRepo.markAsSent(deal.id, tenant.id)
        } catch (err) {
          // log + métrica; segue para o próximo deal
        }
      }
    }
  }
}
```

> **`AffiliateLinker`** é um composite simples: recebe a lista de `AffiliateLinkBuilder` e despacha pelo `deal.marketplace` (`builders.find(b => b.supports(deal.marketplace))`), com passthrough se nenhum suportar. Mantém o use case agnóstico de quantos marketplaces existem.
>
> **Semântica de entrega:** `publish` → `markAsSent` (nesta ordem) é *at-least-once* — se o processo morrer entre os dois, o deal reaparece na próxima rodada e é re-publicado. Para um bot de ofertas, re-enviar raramente é tolerável e duplicar é o pior erro; por isso **não** invertemos a ordem. Se a duplicação virar problema, a alternativa é tornar `publish`+`markAsSent` idempotente por `(deal_id, tenant_id)` na borda do publisher.

### Use Case: Curadoria & Sugestão

Hoje o `sendNextSuggestion` (em `server/index.ts`) faz **muito mais** que publicar deals capturados: ele mantém uma vitrine rotativa que cicla por **todas as categorias** em ordem fixa (round-robin), escolhe aleatoriamente dentro da categoria para dar variedade, evita repetir a mesma fonte (`shopee → amazon → shopee`) e respeita o dedupe de 7 dias. É a lógica de domínio mais rica da base e precisa de um use case próprio — não cabe no `MonitorDeals`.

```typescript
// core/ports/RotationStore.ts
type RotationCursor = { roundRobinIndex: number; lastSource: string | null }

interface RotationStore {
  load(tenantId: string): Promise<RotationCursor>
  save(tenantId: string, cursor: RotationCursor): Promise<void>
  reset(tenantId: string): Promise<void> // chamado pelo reset diário
}

// core/usecases/SuggestDeals.ts
class SuggestDeals {
  constructor(
    private dealRepo: DealRepository,
    private publisher: DealPublisher,
    private affiliate: AffiliateLinker,
    private rotationStore: RotationStore,
    private rotation: CategoryRotation, // lógica pura: dado cursor + pool, escolhe o próximo
  ) {}

  async execute(tenant: Tenant, pool: Deal[]) {
    const excluded = await this.dealRepo.findRecentlySentIds(tenant.id, 7)
    const available = pool.filter(d => !excluded.has(d.id))
    if (!available.length) return

    const cursor = await this.rotationStore.load(tenant.id)
    const { deal, next } = this.rotation.pickNext(available, tenant.filters.categories, cursor)
    if (!deal) return

    const linked = await this.affiliate.build(deal, tenant.affiliates)
    await this.publisher.publish(linked, tenant)
    await this.dealRepo.markAsSent(deal.id, tenant.id)
    await this.rotationStore.save(tenant.id, next) // só avança o cursor se publicou
  }
}
```

**Decisão (resolvida):** o cursor de rotação é **estado por-tenant no banco**, em `rotation_state(tenant_id PK, round_robin_index, last_source)`. Motivo: no multi-tenant cada canal precisa de cobertura de categorias própria e determinística, que sobreviva a restart e a troca de réplica — não pode depender de qual instância ganhou o slot. `CategoryRotation` continua **lógica pura e testável** (round-robin + variedade de fonte): recebe `(pool, categorias, cursor)` e devolve `{ deal, next }`, sem tocar I/O. Quem persiste é o `RotationStore`.

O reset diário (cron `0 0 * * *`) chama `rotationStore.reset(tenantId)` para cada tenant, via `Scheduler`. O `claimAutoSendSlot` continua sendo o lock de *timing* do slot (não confundir com o cursor): garante que só uma réplica dispara por janela; o cursor garante *o que* ela escolhe.

### Use Case: Feedback (likes/dislikes)

O bot do Telegram coleta reações (`dealCardStore`, `feedbackStore`, estatística por categoria em `bot.ts`) para futura curadoria. Hoje isso vive em memória, e a persistência atual (`deal_history.vote`, um voto por deal) não conta múltiplos usuários nem separa por tenant. A **decisão (resolvida)** é uma tabela própria por-usuário, `deal_feedback(deal_id, tenant_id, user_id, reaction)`, que suporta a contagem real de likes/dislikes por categoria que o bot já agrega em memória.

```typescript
// core/ports/FeedbackRepository.ts
type CategoryStats = Record<string, { likes: number; dislikes: number }>

interface FeedbackRepository {
  // upsert: um usuário só conta um voto por deal (PK deal_id+tenant_id+user_id)
  record(deal: Deal, tenantId: string, userId: string, reaction: 'like' | 'dislike'): Promise<void>
  statsByCategory(tenantId: string): Promise<CategoryStats>
}

// core/usecases/RecordFeedback.ts — registra a reação; agregação por categoria sai do repo (GROUP BY)
class RecordFeedback {
  constructor(private feedback: FeedbackRepository) {}
  execute(deal: Deal, tenantId: string, userId: string, reaction: 'like' | 'dislike') {
    return this.feedback.record(deal, tenantId, userId, reaction)
  }
}
```

O `TelegramPublisher` traduz callbacks de botão (que carregam `userId` do Telegram) → `RecordFeedback.execute()`. A categoria não é guardada em `deal_feedback`: é derivada via join com o histórico de deals no `statsByCategory`, evitando duplicar o campo. O agregado por categoria pode no futuro alimentar o `Filter` (priorizar categorias bem avaliadas) — fora do escopo desta migração.

A `deal_history.vote` atual serve de **seed** na migração (um voto global vira uma linha `deal_feedback` com `user_id = 'legacy'`), depois a coluna pode ser descontinuada.

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

-- Cursor de rotação de sugestões, por tenant (substitui roundRobinIndex/lastSentSource in-memory)
CREATE TABLE rotation_state (
  tenant_id         UUID PRIMARY KEY REFERENCES tenants(id),
  round_robin_index INT  NOT NULL DEFAULT 0,
  last_source       TEXT,
  updated_at        TIMESTAMPTZ DEFAULT now()
);

-- Feedback por usuário (substitui deal_history.vote; suporta contagem por categoria/tenant)
CREATE TABLE deal_feedback (
  deal_id    TEXT NOT NULL,
  tenant_id  UUID NOT NULL REFERENCES tenants(id),
  user_id    TEXT NOT NULL,
  reaction   TEXT NOT NULL CHECK (reaction IN ('like', 'dislike')),
  created_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (deal_id, tenant_id, user_id)
);
CREATE INDEX idx_deal_feedback_tenant ON deal_feedback(tenant_id);
```

> **Dedupe de envio** (`deal_history` hoje, alimentado por `recordDealSent`/`getExcludedDealIds`) passa a ser por-tenant na Fase 3: a chave vira `(deal_id, tenant_id)` com `sent_at`, e `findRecentlySentIds(tenant_id, withinDays)` filtra pela janela.

### Migrations de Schema (decidido: `node-pg-migrate` a partir da Fase 3)

Hoje o schema nasce de DDL idempotente no boot (`initLinksTable`, com `CREATE TABLE IF NOT EXISTS` + advisory lock). Funciona para o tamanho atual, mas não versiona mudanças, não dá rollback, e não cobre bem migração de *dados* — exatamente o que a Fase 3 exige (criar 6 tabelas novas **e** mover o `vote` legado para `deal_feedback`, e o dedupe para por-tenant).

**Decisão:** adotar **`node-pg-migrate`** com migrations versionadas, introduzido **no início da Fase 3**. Razões: é o menor salto a partir do DDL que já existe (continua SQL), e a dor de schema só aparece na Fase 3 — Fases 1 e 2 não tocam o banco, então introduzir antes seria ruído.

Como fica:

```
migrations/
  001_initial_schema.sql      ← o initLinksTable atual vira o estado inicial
  002_tenants.sql             ← tenants, tenant_channels, tenant_filters, tenant_affiliates
  003_rotation_state.sql
  004_deal_feedback.sql
  005_dedupe_por_tenant.sql   ← altera deal_history p/ chave (deal_id, tenant_id)
  006_seed_legacy.sql         ← migração de DADOS: vote → deal_feedback, tenant único
```

- A ferramenta mantém uma tabela de controle (`pgmigrations`) anotando o que já rodou; no deploy aplica só as novas, em ordem — sem `IF NOT EXISTS`, sem adivinhação.
- Cada migration tem `up` (aplicar) e `down` (reverter).
- O comando roda no boot (ou num step de deploy do Railway) **antes** do servidor aceitar tráfego; o advisory lock de boot que já existe continua protegendo contra deploys concorrentes.
- Daqui pra frente, **toda** mudança de schema é uma migration nova — nunca mais editar DDL solto.

### REST API (para o futuro frontend)

```
GET    /api/tenants              → lista todos os tenants
POST   /api/tenants              → cria tenant
GET    /api/tenants/:id          → detalhe do tenant
PUT    /api/tenants/:id/config   → atualiza filtros/keywords
GET    /api/deals?tenant_id=x   → histórico de deals enviados
```

## Estratégia de Migração (3 Fases)

### Fase 1 — Só Moves Puros (rename, sem split)

> **Princípio (corrigido):** *só mover o que é seguro mover.* Renomear um arquivo self-contained e atualizar imports é verificável com `tsc --noEmit`. **Dividir** os god-files (`bot.ts`, `index.ts`, `pelando.ts`) **não** é um move — muda fronteiras de módulo, estado compartilhado e closures, e fazer isso *antes* de ter testes é refatorar no escuro. Por isso os splits saem da Fase 1 e entram na Fase 2, cada um emparelhado com o teste que o protege.

Mover só os arquivos coesos e pequenos. Zero mudança de comportamento. Cada passo é um commit deployável.

**Baby steps:**
1. Criar pastas: `core/`, `adapters/`, `jobs/`, `web/`
2. Mover `src/api/amazonAffiliate.ts` → `adapters/affiliates/AmazonAffiliate.ts`
3. Mover `src/api/mercadoLivreAffiliate.ts` → `adapters/affiliates/MLAffiliate.ts`
4. Mover `src/api/shopeeAffiliate.ts` → `adapters/affiliates/ShopeeAffiliate.ts`
5. Mover `src/api/metaClient.ts` → `adapters/publishers/WhatsAppPublisher.ts`
6. Mover `src/content/messageBuilder.ts` → `adapters/publishers/format.ts`
7. Mover `src/server/history.ts` → `adapters/db/HistoryRepository.ts`
8. Mover `src/scraper/productScraper.ts` → `adapters/scrapers/ProductScraper.ts`

`bot.ts`, `index.ts`, `pelando.ts`, `mercadoLivre.ts` e `links.ts` **ficam onde estão** até a Fase 2.

### Fase 2 — Characterize + Extrair Core (testes ⇒ split)

> **Regra de ouro:** para cada god-file, *primeiro* escreva o teste de caracterização que captura o comportamento atual (golden master sobre fixtures), *depois* divida atrás de um port. O teste é a rede de segurança que torna o split seguro — não uma tarefa posterior.

**Baby steps:**
1. Criar `core/domain/Deal.ts`, `Tenant.ts` (tenant único = config atual), `Filter.ts`
2. Criar ports: `DealScraper`, `DealPublisher`, `AffiliateLinkBuilder`, `DealRepository`
3. **Teste de caracterização** do parsing da Pelando (fixtures HTML salvos) → então dividir `content/pelando.ts` em `adapters/scrapers/PelandoScraper.ts` (implementa `DealScraper`) + `jobs/monitorPelando.ts`
4. Idem para `content/mercadoLivre.ts` → `MercadoLivreScraper` + `jobs/monitorML.ts`
5. **Teste de caracterização** dos formatadores/envio do bot → dividir `telegram/bot.ts` em `adapters/publishers/TelegramPublisher.ts` (implementa `DealPublisher`) + `adapters/telegram/commands/`
6. Fazer os affiliates (`AmazonAffiliate`/`MLAffiliate`/`ShopeeAffiliate`) implementarem `AffiliateLinkBuilder` + composite `AffiliateLinker` **+ testes** (URL crua → URL com tag)
7. Extrair `core/usecases/FilterDeals.ts` **+ testes unitários** (golden master sobre fixtures atuais)
8. Extrair `core/usecases/MonitorDeals.ts` **+ testes unitários** (com fakes dos ports)
9. Criar ports `Lock`/`Scheduler` e mover `withCronLock`/`claimAutoSendSlot`/`node-cron` para `adapters/lock` e `adapters/scheduler`
10. Mover `src/server/links.ts` → `adapters/db/PgLinkRepository.ts`; criar port `LinkResolver` (shorten + storePreviewImage)
11. Extrair `core/usecases/SuggestDeals.ts` + `CategoryRotation` (lógica pura) + port `RotationStore` (impl single-tenant in-memory/linha única nesta fase) **+ testes do `CategoryRotation`**
12. Extrair `core/usecases/RecordFeedback.ts` + port `FeedbackRepository`
13. Dividir o resto de `server/index.ts` → `web/server.ts` + `web/routes/` + `index.ts` (composição/DI ligando tudo)

### Fase 3 — Multi-tenancy

Adicionar suporte a múltiplos tenants no banco e expor API REST.

**Baby steps:**
1. Instalar `node-pg-migrate`; transformar o `initLinksTable` atual na migration `001_initial_schema`; rodar migrations no boot (antes de aceitar tráfego), protegido pelo advisory lock de boot
2. Migration `002`: `tenants`, `tenant_channels`, `tenant_filters`, `tenant_affiliates`
3. Criar `core/ports/TenantRepository.ts` + `adapters/db/PgTenantRepository.ts`
4. Migration de dados (seed): tenant único atual → tabela `tenants` (idempotente)
5. Adaptar `MonitorDeals`/`SuggestDeals` para iterar por tenant
6. Migration: dedupe por-tenant em `deal_history` chave `(deal_id, tenant_id)`; `findRecentlySentIds(tenant_id, dias)`
7. Migration `rotation_state` + `adapters/db/PgRotationStore` (implementa `RotationStore`); seed do cursor atual
8. Migration `deal_feedback` + `adapters/db/PgFeedbackRepository`; seed de `deal_history.vote` como `user_id='legacy'`
9. Criar `core/usecases/ManageTenant.ts`
10. Criar `web/routes/api/tenants.ts`
11. Criar `web/routes/api/config.ts`
12. Criar `web/routes/api/deals.ts`

## Ponto de Composição (index.ts)

```typescript
// src/index.ts
import { Pool } from 'pg'
import { Telegraf } from 'telegraf'
import { PgTenantRepository } from './adapters/db/PgTenantRepository.js'
import { PgDealRepository } from './adapters/db/PgDealRepository.js'
import { PelandoScraper } from './adapters/scrapers/PelandoScraper.js'
import { TelegramPublisher } from './adapters/publishers/TelegramPublisher.js'
import { AmazonAffiliate, MLAffiliate, ShopeeAffiliate } from './adapters/affiliates/index.js'
import { AffiliateLinker } from './core/usecases/AffiliateLinker.js'
import { FilterDeals } from './core/usecases/FilterDeals.js'
import { MonitorDeals } from './core/usecases/MonitorDeals.js'

const db = new Pool({ connectionString: process.env.DATABASE_URL })
const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN!)

const tenantRepo = new PgTenantRepository(db)
const dealRepo = new PgDealRepository(db)
const pelandoScraper = new PelandoScraper()
const telegramPublisher = new TelegramPublisher(bot)
const affiliate = new AffiliateLinker([
  new AmazonAffiliate(), new MLAffiliate(), new ShopeeAffiliate(),
])
const filterDeals = new FilterDeals()

const monitorDeals = new MonitorDeals(
  pelandoScraper, telegramPublisher, affiliate, dealRepo, tenantRepo, filterDeals
)
```

## Princípios de Implementação

- **Cada baby step é um commit deployável** — nunca quebra produção
- **Fase 1 não muda comportamento** — só move arquivos e atualiza imports
- **Fase 2 pode ser feita arquivo por arquivo** — um port por vez
- **Fase 3 é aditiva** — multi-tenancy começa com tenant único migrado
- **Sem frameworks de DI** — injeção manual no `index.ts` é suficiente para o tamanho atual

## Concerns Transversais

A base de código atual carrega responsabilidades que não cabem limpo em "scraper" ou "publisher". O desenho hexagonal precisa de um lar explícito para cada uma, senão elas voltam a vazar para dentro do core.

### Cron / Distributed Lock

O lock distribuído **já existe** e está provado em produção — não é coisa a inventar, é coisa a extrair. Em `server/links.ts` há `withCronLock(lockId, fn)` (usando `pg_try_advisory_lock`, retorna `null` se não adquiriu) e `claimAutoSendSlot(seconds)` (janela de slot para a sugestão). Há quatro agendamentos hoje em `index.ts`:

| Cron | Frequência | Lock atual |
|------|-----------|------------|
| `refreshDeals` | `*/30 * * * *` | — (só atualiza cache in-memory) |
| `monitorPelando` | `*/30 * * * *` | `withCronLock(111222333)` |
| `sendNextSuggestion` | `*/15 7-22 * * *` | `claimAutoSendSlot(13)` |
| reset diário | `0 0 * * *` | — (limpa `sentToday`) |

Mais o lock DDL de boot, `pg_advisory_lock(987654321)` em `initLinksTable`, que é singleton de inicialização de schema — **lock diferente**, fica em `adapters/db`.

Isso é orquestração, não regra de negócio. Os ports abstraem o que já existe:

```typescript
// core/ports/Scheduler.ts
interface Scheduler {
  schedule(name: string, cron: string, job: () => Promise<void>): void
}

// core/ports/Lock.ts — withCronLock + claimAutoSendSlot já implementam isto
interface Lock {
  withLock<T>(key: string, fn: () => Promise<T>): Promise<T | null> // null = não adquirido
}
```

O use case nunca conhece cron nem lock. Quem amarra os três (scheduler + lock + use case) é `jobs/`:

```typescript
// jobs/monitorPelando.ts
export function registerPelandoMonitor(scheduler: Scheduler, lock: Lock, monitor: MonitorDeals) {
  scheduler.schedule('pelando', '*/30 * * * *', () =>
    lock.withLock('monitor:pelando', () => monitor.execute()),
  )
}
```

`adapters/lock/PgAdvisoryLock.ts` é a casa do `withCronLock`/`claimAutoSendSlot` atuais; `adapters/scheduler/NodeCronScheduler.ts` embrulha o `node-cron`. A migração aqui é mecânica: mover funções existentes para trás dos ports, sem reescrever a lógica de lock.

### Link Shortener + Image Storage

O redirect de links e o armazenamento de imagens (BYTEA no PG, alimentado pelas fotos entregues no Telegram para corrigir os 403 do CDN da Pelando) são **um adapter de apresentação de links**, não parte do domínio de deals.

```typescript
// core/ports/LinkResolver.ts
interface LinkResolver {
  shorten(url: string): Promise<string>         // retorna /r/:slug
  storePreviewImage(slug: string, img: Buffer): Promise<void>
}
```

- `adapters/db/PgLinkRepository.ts` → slug ↔ url + coluna BYTEA da imagem.
- `web/routes/redirect/links.ts` → `GET /r/:slug` (302) e `GET /r/:slug/image` (preview para o link unfurl).
- A injeção de imagem a partir das fotos do Telegram vira um passo do `TelegramPublisher` que, após enviar, chama `linkResolver.storePreviewImage`.

### Coupons

Coupons compartilham o pipeline de deals mas têm forma própria (código + título + loja). Em vez de um port separado, são um `Deal` com `couponCode` preenchido — `FilterDeals` e `DealPublisher` já lidam com o campo opcional. O scraping de coupons da Pelando (FlareSolverr → fallback Playwright) fica encapsulado dentro do `PelandoScraper`; o core não sabe que Cloudflare existe.

### Anti-bot (FlareSolverr / Playwright)

Toda a complexidade de Cloudflare, FlareSolverr e fallback Playwright vive **dentro** dos adapters de scraping. O port `DealScraper` expõe só `fetchDeals()`. Trocar a estratégia anti-bot nunca toca o core nem os use cases.

### Estado In-Memory

Hoje há quatro pedaços de estado mutável vivendo solto em `index.ts`. A migração precisa decidir conscientemente o que persiste e o que pode morrer no restart:

| Estado | O que é | Decisão |
|--------|---------|---------|
| `dealsCache` | working set de deals capturados (refresh 30 min) | **fica in-memory** — é cache, reconstruído por `refreshDeals`; é o `pool` que `SuggestDeals` consome |
| `imageCache` (`Map`) | cache de imagens de preview | **fica in-memory**; a persistência real já é o BYTEA via `LinkResolver` |
| `seenPelandoIds` (`Set`) | dedupe de scraping numa rodada | **fica in-memory** — escopo de uma execução do monitor |
| `sentToday` (`Set`) + `roundRobinIndex` | dedupe diário + posição da rotação | **vai pro banco** — dedupe via `DealRepository` (7 dias, por-tenant); o cursor de rotação vira `rotation_state` por-tenant (decisão na Fase 3, ver SuggestDeals) |

Regra: cache reconstruível pode ficar em memória; *dedupe de "já enviei isto ao usuário"* tem que sobreviver a restart e deploy — e já sobrevive, via `recordDealSent`/`getExcludedDealIds`. A Fase 2 só formaliza isso atrás do `DealRepository`.

## Estratégia de Testes

A motivação central da arquitetura: tornar a lógica testável sem rede, sem browser, sem banco.

| Camada | Como testar | Dependências |
|--------|-------------|--------------|
| `core/usecases` | Unit, com fakes dos ports | nenhuma — puro |
| `core/domain` | Unit puro | nenhuma |
| `adapters/scrapers` | Integração contra fixtures HTML salvos | sem rede |
| `adapters/db` | Integração contra Postgres efêmero | docker/CI |
| `web/routes` | Teste de rota com use cases fakeados | nenhuma |

```typescript
// exemplo: MonitorDeals testável com fakes
const scraper: DealScraper = { fetchDeals: async () => [fakeDeal] }
const published: Deal[] = []
const publisher: DealPublisher = { publish: async (d) => { published.push(d) } }

await new MonitorDeals(scraper, publisher, fakeDealRepo, fakeTenantRepo, new FilterDeals())
  .execute()

expect(published).toHaveLength(1)
```

Meta mínima: cobrir `FilterDeals` (lógica de keyword/desconto/dedupe) e `MonitorDeals` com testes unitários antes de a Fase 2 terminar — é o coração das regras de negócio e o que mais quebra silenciosamente hoje.

## Mapeamento Atual → Target

| Arquivo atual | Destino | Fase |
|---------------|---------|------|
| `src/api/amazonAffiliate.ts` | `adapters/affiliates/AmazonAffiliate.ts` | 1 |
| `src/api/mercadoLivreAffiliate.ts` | `adapters/affiliates/MLAffiliate.ts` | 1 |
| `src/api/shopeeAffiliate.ts` | `adapters/affiliates/ShopeeAffiliate.ts` | 1 |
| `src/api/metaClient.ts` | `adapters/publishers/WhatsAppPublisher.ts` | 1 |
| `src/server/links.ts` | `adapters/db/PgLinkRepository.ts` + `web/routes/redirect/links.ts` | 1 |
| `src/server/history.ts` | `adapters/db/HistoryRepository.ts` | 1 |
| `src/scraper/productScraper.ts` | `adapters/scrapers/ProductScraper.ts` | 1 |
| `src/content/pelando.ts` | `adapters/scrapers/PelandoScraper.ts` + `jobs/monitorPelando.ts` | 1 |
| `src/content/mercadoLivre.ts` | `adapters/scrapers/MercadoLivreScraper.ts` + `jobs/monitorML.ts` | 1 |
| `src/content/messageBuilder.ts` | `adapters/publishers/format.ts` (`buildMessagePayload`, `fmt`) | 1 |
| `src/telegram/bot.ts` | `adapters/publishers/TelegramPublisher.ts` + `adapters/telegram/commands/` + use case `RecordFeedback` | 1–2 |
| `src/server/index.ts` | `web/server.ts` + `web/routes/` + `jobs/` + `index.ts` | 1 |
| `withCronLock` / `claimAutoSendSlot` (em `links.ts`) | `adapters/lock/PgAdvisoryLock.ts` | 1 |
| `cron.schedule(...)` + `node-cron` (em `index.ts`) | `adapters/scheduler/NodeCronScheduler.ts` + `jobs/*` | 1 |
| `sendNextSuggestion` + `roundRobinIndex`/`lastSentSource` | `core/usecases/SuggestDeals.ts` + `CategoryRotation` | 2 |
| `dealsCache` / `refreshDeals` (estado in-memory) | working set; ver "Estado In-Memory" | 2 |

## Riscos & Mitigações

| Risco | Mitigação |
|-------|-----------|
| Mudança de imports em massa na Fase 1 quebra o build | Mover um arquivo por commit; `tsc --noEmit` + deploy em cada passo |
| Dividir god-file sem rede de segurança (`bot.ts`/`pelando.ts`/`index.ts`) | Split foi movido para a Fase 2 e **só após** o teste de caracterização do arquivo |
| Regressão silenciosa no filtro de deals ao extrair `FilterDeals` | Escrever os testes unitários **antes** de extrair (golden master sobre fixtures atuais) |
| Falha de envio (429 do Telegram, rede) aborta o lote inteiro | `try/catch` por deal no use case; um deal/tenant que falha não derruba os demais |
| Esquecer de aplicar o afiliado → tráfego sem monetização | `AffiliateLinker.build` é passo obrigatório antes de `publish`; teste cobre URL crua → URL com tag |
| Estado in-memory de coupons/deals enviados se perde no restart | Já há dedupe no PG (`recordDealSent`/`getExcludedDealIds`); formalizado atrás de `DealRepository.findRecentlySentIds` na Fase 2 |
| Multi-tenancy multiplica requisições de scraping por tenant | Scraping é **por marketplace, não por tenant** — `fetchDeals` roda uma vez, o fan-out é só na publicação/filtragem |
| Migração do tenant único corrompe config de produção | Seeding idempotente; manter env vars antigas como fallback até o tenant no banco estar validado |

## Não-Objetivos (por enquanto)

- Frontend de configuração — a API REST é o contrato; a UI vem depois.
- Autenticação/billing do SaaS — fora do escopo desta migração estrutural.
- Troca de Postgres por outro banco — o port `*Repository` permite, mas não é meta.
- Event sourcing / filas (SQS/Kafka) — cron + lock cobrem o volume atual.
- Microsserviços — segue monólito modular; hexagonal não implica deploy separado.

## Decisões em Aberto

- **`Deal.id` precisa ser chave natural estável.** Todo o dedupe (`findRecentlySentIds`, `markAsSent`) e o feedback (`deal_feedback`) dependem de o `id` ser o mesmo entre execuções de scraping para o mesmo produto. **A definir explicitamente:** é o ID nativo do marketplace, ou um hash da URL canônica? Se for hash, a normalização da URL vira regra de domínio (e tem que ser idempotente).
- **Filtro por tenant vs por canal.** `Tenant` tem N `channels` mas um único `Filter`. Se um cliente quiser um canal de "games" e outro de "casa", o modelo não suporta. Aceitável para o MVP (1 tenant = 1 feed curado, múltiplas entregas), mas é um limite a confirmar com o produto antes da Fase 3.

## Critérios de Sucesso

1. `tsc --noEmit` passa em cada commit das três fases.
2. Nenhum arquivo de `core/` importa de `adapters/`, `web/` ou `jobs/` (verificável por lint de dependência).
3. `FilterDeals` e `MonitorDeals` têm testes unitários sem mocks de rede/DB.
4. Adicionar um novo marketplace = criar um `adapters/scrapers/XScraper.ts` que implementa `DealScraper` + registrar em `index.ts`, sem tocar core nem outros adapters.
5. Produção segue rodando sem interrupção durante toda a migração (cada baby step é deployável).
6. Todo deal publicado passou pelo `AffiliateLinker` — nenhum link sai sem tag de afiliado (coberto por teste do use case).
