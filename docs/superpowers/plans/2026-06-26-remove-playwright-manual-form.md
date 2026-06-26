# Remove Playwright & Manual Product Form Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remover Playwright e scrapers automáticos, substituindo o fluxo de scraping por formulário manual com auto-preenchimento leve (axios) e upload de imagem.

**Architecture:** `quickFetchProduct` (axios) substitui `scrapeProduct` (Playwright) para auto-preenchimento opcional; uploads de imagem são armazenados em uma tabela `temp_images` no PostgreSQL e servidos pelo servidor principal; o dashboard exibe o formulário imediatamente com campos editáveis.

**Tech Stack:** TypeScript, Node.js, Express 5, PostgreSQL (pg), axios, Vitest

## Global Constraints

- TypeScript strict — sem `any` implícito
- Imports com extensão `.js` (ESM)
- Run tests: `npm test`
- Build: `npm run build` — deve passar sem erros após cada task
- Nunca usar `scrapeProduct`, `chromium`, ou `playwright` após Task 1

---

## File Map

| Ação | Arquivo |
|---|---|
| Modify | `src/adapters/scrapers/ProductScraper.ts` |
| Delete | `src/adapters/scrapers/ShopeeCouponScraper.ts` |
| Delete | `src/adapters/scrapers/PelandoScraper.ts` |
| Delete | `src/adapters/scrapers/MercadoLivreScraper.ts` |
| Delete | `src/jobs/monitorPelando.ts` |
| Delete | `src/jobs/monitorML.ts` |
| Modify | `src/index.ts` |
| Modify | `src/web/server.ts` |
| Modify | `public/index.html` |
| Modify | `tests/wiring/composition.test.ts` |

---

## Task 1: Remover Playwright do ProductScraper + uninstall pacotes

**Files:**
- Modify: `src/adapters/scrapers/ProductScraper.ts`
- Delete: `src/adapters/scrapers/ShopeeCouponScraper.ts`

**Interfaces:**
- Produces: `quickFetchProduct(url: string): Promise<ProductData | null>` e `ProductData` — inalterados
- Remove: `scrapeProduct` — não deve mais existir

- [ ] **Step 1: Reescrever ProductScraper.ts sem Playwright**

Substituir o conteúdo inteiro do arquivo por:

```typescript
import axios from 'axios'

function decodeHtmlEntities(str: string): string {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)))
}

function extractOgTag(html: string, property: string): string {
  const re1 = new RegExp(`<meta[^>]+property=["']${property}["'][^>]+content=["']([^"']+)["']`, 'i')
  const re2 = new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']${property}["']`, 'i')
  return html.match(re1)?.[1] ?? html.match(re2)?.[1] ?? ''
}

export interface ProductData {
  name: string
  price: string
  originalPrice?: string
  imageUrl: string
  originalUrl: string
}

export async function quickFetchProduct(url: string): Promise<ProductData | null> {
  try {
    const res = await axios.get<string>(url, {
      timeout: 12000,
      responseType: 'text',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
        'Accept-Encoding': 'gzip, deflate, br',
      },
      maxRedirects: 5,
    })

    const html = res.data as string

    const rawName = decodeHtmlEntities(
      extractOgTag(html, 'og:title') ||
      html.match(/<title[^>]*>([^<|]+)/i)?.[1]?.trim() ||
      ''
    )

    const imageUrl =
      extractOgTag(html, 'og:image') ||
      html.match(/"hiRes"\s*:\s*"(https:[^"]+)"/)?.[1] ||
      html.match(/data-old-hires="(https:[^"]+)"/)?.[1] ||
      ''

    if (!rawName) return null

    const name = rawName.length > 60 ? rawName.slice(0, 57) + '...' : rawName

    const displayPrice = html.match(/"displayPrice"\s*:\s*"([^"]+)"/)?.[1]?.trim()
    const priceAmount = html.match(/"priceAmount"\s*:\s*"?([\d.,]+)"?/)?.[1]
    const price = displayPrice ?? (priceAmount ? formatRawPrice(priceAmount) : '')

    return { name, price, imageUrl, originalUrl: url }
  } catch {
    return null
  }
}

function formatRawPrice(raw: string | undefined): string {
  if (!raw) return ''
  const cleaned = raw.trim()
  if (!cleaned) return ''
  if (cleaned.includes('R$')) return cleaned
  const num = parseFloat(cleaned.replace(',', '.'))
  if (isNaN(num)) return cleaned
  return `R$${num.toFixed(2).replace('.', ',')}`
}
```

- [ ] **Step 2: Deletar ShopeeCouponScraper.ts**

```bash
rm src/adapters/scrapers/ShopeeCouponScraper.ts
```

- [ ] **Step 3: Desinstalar pacotes Playwright**

```bash
npm uninstall playwright playwright-extra puppeteer-extra-plugin-stealth
```

Expected: pacotes removidos de `package.json` e `node_modules`.

- [ ] **Step 4: Verificar build**

```bash
npm run build 2>&1 | head -30
```

Expected: erros apenas relacionados a imports que ainda referenciam os arquivos deletados (serão corrigidos nas próximas tasks). Se houver erro em `ProductScraper.ts` em si, corrija antes de continuar.

- [ ] **Step 5: Commit**

```bash
git add src/adapters/scrapers/ProductScraper.ts src/adapters/scrapers/ShopeeCouponScraper.ts package.json package-lock.json
git commit -m "feat: remover Playwright do ProductScraper e deletar ShopeeCouponScraper"
```

---

## Task 2: Remover scrapers automáticos, jobs e limpar index.ts

**Files:**
- Delete: `src/adapters/scrapers/PelandoScraper.ts`
- Delete: `src/adapters/scrapers/MercadoLivreScraper.ts`
- Delete: `src/jobs/monitorPelando.ts`
- Delete: `src/jobs/monitorML.ts`
- Modify: `src/index.ts`
- Modify: `tests/wiring/composition.test.ts`

**Interfaces:**
- Consumes: nada das tasks anteriores (independente)
- Produces: `src/index.ts` limpo sem referências a Pelando/ML/ShopeeCoupon scrapers

- [ ] **Step 1: Deletar arquivos de scraper e jobs**

```bash
rm src/adapters/scrapers/PelandoScraper.ts
rm src/adapters/scrapers/MercadoLivreScraper.ts
rm src/jobs/monitorPelando.ts
rm src/jobs/monitorML.ts
```

- [ ] **Step 2: Reescrever src/index.ts**

Substituir o conteúdo inteiro por:

```typescript
import 'dotenv/config'
import path from 'path'
import { runner } from 'node-pg-migrate'

// ── Adapters ──────────────────────────────────────────────────────────────────
import { PgAdvisoryLock } from './adapters/lock/PgAdvisoryLock.js'
import { PgRotationStore } from './adapters/store/PgRotationStore.js'
import { PgDealRepository } from './adapters/db/PgDealRepository.js'
import { PgTenantRepository } from './adapters/db/PgTenantRepository.js'
import { TelegramPublisher } from './adapters/publishers/TelegramPublisher.js'
import { NodeCronScheduler } from './adapters/scheduler/NodeCronScheduler.js'
import { AmazonAffiliateLinkBuilder } from './adapters/affiliates/AmazonAffiliate.js'
import { MLAffiliateLinkBuilder } from './adapters/affiliates/MLAffiliate.js'
import { ShopeeAffiliateLinkBuilder } from './adapters/affiliates/ShopeeAffiliate.js'
import { CompositeAffiliateLinkBuilder } from './adapters/affiliates/CompositeAffiliateLinkBuilder.js'

// ── Use cases ─────────────────────────────────────────────────────────────────
import { SuggestDeals } from './core/usecases/SuggestDeals.js'

// ── Job registrations ─────────────────────────────────────────────────────────
import { registerSuggestionJobs } from './jobs/cronLock.js'
import { refreshDeals } from './web/server.js'
import { setShopeeCouponTrigger, sendCouponAlertToChat } from './adapters/publishers/TelegramPublisher.js'
import { setTenantRepo } from './web/server.js'
import { generateAffiliateLink } from './adapters/affiliates/ShopeeAffiliate.js'

// ── Migration runner ──────────────────────────────────────────────────────────
async function runMigrations(): Promise<void> {
  await runner({
    databaseUrl: process.env.DATABASE_URL!,
    dir: path.resolve(process.cwd(), 'migrations'),
    direction: 'up',
    migrationsTable: 'pgmigrations',
    log: (msg: string) => console.log('[migrations]', msg),
  })
}

// ── Boot ──────────────────────────────────────────────────────────────────────
console.log('[boot] running migrations...')
await runMigrations()
console.log('[boot] migrations complete')

// ── Instantiate adapters ──────────────────────────────────────────────────────
const lock = new PgAdvisoryLock()
const rotationStore = new PgRotationStore()
const dealRepo = new PgDealRepository()
const tenantRepo = new PgTenantRepository()
const telegramPublisher = new TelegramPublisher()
const scheduler = new NodeCronScheduler()

// ── Affiliate link builder ────────────────────────────────────────────────────
const affiliateBuilder = new CompositeAffiliateLinkBuilder([
  new AmazonAffiliateLinkBuilder(),
  new MLAffiliateLinkBuilder(),
  new ShopeeAffiliateLinkBuilder(),
])

// ── Build use cases ───────────────────────────────────────────────────────────
const suggest = new SuggestDeals(rotationStore, dealRepo, telegramPublisher, affiliateBuilder)

// ── Inject tenant repository into web layer ───────────────────────────────────
setTenantRepo(tenantRepo)

// ── Wire Shopee coupon bot command ────────────────────────────────────────────
const SHOPEE_COUPON_PAGE = 'https://shopee.com.br/m/cupom-de-desconto'

async function runShopeeCouponAlert(): Promise<void> {
  const affiliateUrl = await generateAffiliateLink(SHOPEE_COUPON_PAGE).catch(() => SHOPEE_COUPON_PAGE)
  await sendCouponAlertToChat([], affiliateUrl)
}

setShopeeCouponTrigger(runShopeeCouponAlert)

// ── Register jobs ─────────────────────────────────────────────────────────────
registerSuggestionJobs(scheduler, suggest, rotationStore, tenantRepo)

// Refresh Shopee deal cache every 6 hours
scheduler.schedule('shopee-refresh', '0 8,14,20 * * *', async () => {
  console.log('[shopee-refresh] Atualizando cache de produtos...')
  await refreshDeals()
})

// Shopee coupon alert every 4h
scheduler.schedule('shopee-coupon-monitor', '0 9,13,17,21 * * *', async () => {
  console.log('[shopee-coupons] Verificando cupons Shopee...')
  try {
    await runShopeeCouponAlert()
    console.log('[shopee-coupons] ✓ Alerta enviado')
  } catch (err) {
    console.error('[shopee-coupons] Erro:', err instanceof Error ? err.message : err)
  }
})

// ── Start web server ──────────────────────────────────────────────────────────
// Note: server.ts is already imported via `setTenantRepo` above.
```

- [ ] **Step 3: Atualizar tests/wiring/composition.test.ts**

Substituir o conteúdo por (remove os testes de Pelando/ML, mantém apenas suggestion jobs):

```typescript
import { describe, it, expect, vi } from 'vitest'
import type { Scheduler } from '../../src/core/ports/Scheduler.js'
import type { Lock } from '../../src/core/ports/Lock.js'
import type { RotationStore, RotationCursor } from '../../src/core/ports/RotationStore.js'
import type { DealRepository } from '../../src/core/ports/DealRepository.js'
import type { DealPublisher } from '../../src/core/ports/DealPublisher.js'
import type { TenantRepository } from '../../src/core/ports/TenantRepository.js'
import type { Tenant } from '../../src/core/domain/Tenant.js'
import { SuggestDeals } from '../../src/core/usecases/SuggestDeals.js'
import { registerSuggestionJobs } from '../../src/jobs/cronLock.js'

class FakeScheduler implements Scheduler {
  readonly scheduled: Array<{ name: string; cron: string }> = []
  schedule(name: string, cron: string, _job: () => Promise<void>): void {
    this.scheduled.push({ name, cron })
  }
}

const fakeRotationStore: RotationStore = {
  load: async (_tenantId: string): Promise<RotationCursor> => ({ roundRobinIndex: 0, lastSource: null }),
  save: async (_tenantId: string, _cursor: RotationCursor): Promise<void> => void 0,
  reset: async (_tenantId: string): Promise<void> => void 0,
}

const fakeDealRepo: DealRepository = {
  findRecentlySentIds: async (_tenantId: string, _withinDays: number): Promise<Set<string>> => new Set(),
  markAsSent: async (_dealId: string, _tenantId: string): Promise<void> => void 0,
}

const fakePublisher: DealPublisher = {
  publish: vi.fn().mockResolvedValue(undefined),
}

const fakeTenant: Tenant = {
  id: 'tenant-1',
  name: 'Test Tenant',
  active: true,
  channels: [],
  filters: { keywords: [], excludeKeywords: [], minDiscount: 0, categories: [] },
  affiliates: {},
}

const fakeTenantRepo: TenantRepository = {
  findAll: async (): Promise<Tenant[]> => [fakeTenant],
  findById: async (_id: string): Promise<Tenant | null> => null,
  save: async (_tenant: Tenant): Promise<void> => void 0,
}

describe('composition root wiring', () => {
  it('registerSuggestionJobs schedules suggest-deals and reset-rotation', () => {
    const scheduler = new FakeScheduler()
    const suggest = new SuggestDeals(fakeRotationStore, fakeDealRepo, fakePublisher)

    registerSuggestionJobs(scheduler, suggest, fakeRotationStore, fakeTenantRepo)

    const names = scheduler.scheduled.map(s => s.name)
    expect(names).toContain('suggest-deals')
    expect(names).toContain('reset-rotation')
    expect(scheduler.scheduled.find(s => s.name === 'suggest-deals')?.cron).toBe('*/30 7-22 * * *')
    expect(scheduler.scheduled.find(s => s.name === 'reset-rotation')?.cron).toBe('0 0 * * *')
  })
})
```

- [ ] **Step 4: Rodar testes**

```bash
npm test
```

Expected: todos os testes passam. Se `composition.test.ts` falhar, verifique os imports.

- [ ] **Step 5: Verificar build**

```bash
npm run build 2>&1 | head -30
```

Expected: apenas erros de `server.ts` (ainda referencia scrapeProduct e PelandoScraper — será corrigido na Task 3).

- [ ] **Step 6: Commit**

```bash
git add src/adapters/scrapers/PelandoScraper.ts src/adapters/scrapers/MercadoLivreScraper.ts src/jobs/monitorPelando.ts src/jobs/monitorML.ts src/index.ts tests/wiring/composition.test.ts
git commit -m "feat: remover scrapers automáticos Pelando e ML e limpar index.ts"
```

---

## Task 3: Simplificar server.ts — /api/scrape, upload endpoint, temp_images

**Files:**
- Modify: `src/web/server.ts`

**Interfaces:**
- Consumes: `quickFetchProduct(url): Promise<ProductData | null>` de `ProductScraper.ts`
- Produces:
  - `POST /api/scrape` → `{ partial: boolean, name: string, price: string, imageUrl: string, originalUrl: string }`
  - `POST /api/upload-image` → `{ imageUrl: string }` (URL pública da imagem)
  - `GET /img/upload/:id` → bytes da imagem (Content-Type correto)

- [ ] **Step 1: Remover imports desnecessários no topo do server.ts**

Localizar e remover estas linhas:

```typescript
import { scrapeProduct } from '../adapters/scrapers/ProductScraper.js'
import { fetchDeals as fetchPelandoDeals } from '../adapters/scrapers/PelandoScraper.js'
import type { PelandoDeal } from '../adapters/scrapers/PelandoScraper.js'
import { withCronLock } from '../adapters/lock/PgAdvisoryLock.js'
```

Adicionar estas linhas ao bloco de imports:

```typescript
import { pool } from '../adapters/db/pool.js'
```

Também atualizar o import de crypto para incluir `randomBytes`:

```typescript
import { createHmac, createHash, randomBytes } from 'crypto'
```

- [ ] **Step 2: Remover variáveis e funções Pelando/ML**

Remover completamente os seguintes blocos de `server.ts`:

- A linha: `const recentCoupons: PelandoDeal[] = []`
- A função exportada: `export function getCachedCoupons(): PelandoDeal[] { ... }`
- A const: `const seenPelandoIds = new Set<string>()`
- A função: `export async function monitorPelando(): Promise<void> { ... }`
- A função: `async function _monitorPelando(): Promise<void> { ... }` (toda ela, ~70 linhas)
- A função: `export async function monitorML(): Promise<void> { ... }` (toda ela, ~30 linhas)

- [ ] **Step 3: Simplificar refreshDeals() — remover filtro Pelando**

Substituir o corpo de `refreshDeals()` para não tentar preservar deals de Pelando:

```typescript
export async function refreshDeals() {
  const now = new Date().toISOString()
  const shopeeResults: UnifiedDeal[] = []

  if (process.env.SHOPEE_APP_ID && process.env.SHOPEE_SECRET) {
    try {
      const shopeeProducts = await fetchShopeeDeals(8)
      for (const p of shopeeProducts) {
        const priceNum = parseFloat(p.price)
        const originalNum = p.priceDiscountRate > 0
          ? priceNum / (1 - p.priceDiscountRate / 100)
          : undefined
        shopeeResults.push({
          id: String(p.itemId),
          title: p.productName.slice(0, 80),
          price: `R$${priceNum.toFixed(2).replace('.', ',')}`,
          originalPrice: originalNum ? `R$${originalNum.toFixed(2).replace('.', ',')}` : undefined,
          discountPercent: p.priceDiscountRate,
          commissionRate: `${(parseFloat(p.commissionRate) * 100).toFixed(0)}%`,
          ratingStar: p.ratingStar,
          store: p.shopName,
          imageUrl: p.imageUrl,
          affiliateUrl: p.offerLink,
          productLink: p.productLink,
          shopId: p.shopId,
          source: 'shopee',
          category: p.category,
          publishedAt: now,
        })
      }
      console.log(`[shopee] ✓ ${shopeeResults.length} produtos encontrados`)
    } catch (err) {
      console.error('[shopee] Erro:', err instanceof Error ? err.message : err)
    }
  }

  dealsCache = [...shopeeResults]
}
```

- [ ] **Step 4: Substituir POST /api/scrape**

Encontrar o bloco:
```typescript
// POST /api/scrape
app.post('/api/scrape', async (req, res) => {
  const { url } = req.body as { url?: string }
  if (!url) return res.status(400).json({ error: 'URL é obrigatória' })
  try {
    const product = await scrapeProduct(url)
    res.json(product)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erro ao extrair produto'
    console.error('[scrape]', message)
    res.status(500).json({ error: message })
  }
})
```

Substituir por:
```typescript
// POST /api/scrape — axios only, returns partial data on failure (never 500)
app.post('/api/scrape', async (req, res) => {
  const { url } = req.body as { url?: string }
  if (!url) return res.status(400).json({ error: 'URL é obrigatória' })
  const product = await quickFetchProduct(url)
  if (product) {
    return res.json({ ...product, partial: false })
  }
  return res.json({ partial: true, name: '', price: '', imageUrl: '', originalUrl: url })
})
```

- [ ] **Step 5: Adicionar DDL de temp_images em initLinksTable**

Em `PgLinkRepository.ts`, dentro do bloco `_runInit()`, após a criação das outras tabelas, adicionar:

```typescript
await client.query(`
  CREATE TABLE IF NOT EXISTS temp_images (
    id         TEXT        PRIMARY KEY,
    image_data BYTEA       NOT NULL,
    image_mime TEXT        NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )
`)
```

- [ ] **Step 6: Adicionar POST /api/upload-image em server.ts**

Logo após o endpoint `POST /api/scrape`, adicionar:

```typescript
// POST /api/upload-image — recebe imagem em base64, armazena em temp_images
app.post('/api/upload-image', async (req, res) => {
  const { data, mime } = req.body as { data?: string; mime?: string }
  const ALLOWED_MIMES = ['image/jpeg', 'image/png', 'image/webp']
  if (!data || !mime || !ALLOWED_MIMES.includes(mime)) {
    return res.status(400).json({ error: 'Imagem inválida (jpeg/png/webp esperado)' })
  }
  const buffer = Buffer.from(data, 'base64')
  if (buffer.length > 5 * 1024 * 1024) {
    return res.status(400).json({ error: 'Imagem muito grande (máx 5MB)' })
  }
  const id = 'up' + randomBytes(4).toString('hex')
  try {
    await pool.query(
      'INSERT INTO temp_images (id, image_data, image_mime) VALUES ($1, $2, $3)',
      [id, buffer, mime]
    )
    const base = process.env.BASE_URL || `http://localhost:${PORT}`
    return res.json({ imageUrl: `${base}/img/upload/${id}` })
  } catch (err) {
    console.error('[upload-image]', err)
    return res.status(500).json({ error: 'Erro ao salvar imagem' })
  }
})
```

- [ ] **Step 7: Adicionar GET /img/upload/:id em server.ts**

Logo após o endpoint `GET /img/:code`, adicionar:

```typescript
// GET /img/upload/:id — serve imagem de upload temporário
app.get('/img/upload/:id', async (req, res) => {
  const id = String(req.params.id)
  try {
    const { rows } = await pool.query(
      'SELECT image_data, image_mime FROM temp_images WHERE id = $1',
      [id]
    )
    if (!rows[0]) return res.status(404).json({ error: 'Imagem não encontrada' })
    res.set('Content-Type', (rows[0].image_mime as string) || 'image/jpeg')
    res.set('Cache-Control', 'public, max-age=86400')
    return res.send(rows[0].image_data as Buffer)
  } catch (err) {
    console.error('[/img/upload/:id]', err)
    return res.status(502).json({ error: 'Erro ao buscar imagem' })
  }
})
```

- [ ] **Step 8: Verificar build completo**

```bash
npm run build 2>&1 | head -40
```

Expected: zero erros de TypeScript.

- [ ] **Step 9: Rodar testes**

```bash
npm test
```

Expected: todos passam.

- [ ] **Step 10: Commit**

```bash
git add src/web/server.ts src/adapters/db/PgLinkRepository.ts
git commit -m "feat: simplificar /api/scrape, adicionar upload de imagem e tabela temp_images"
```

---

## Task 4: Atualizar dashboard — formulário editável, upload de imagem, remover Amazon

**Files:**
- Modify: `public/index.html`

**Interfaces:**
- Consumes: `POST /api/scrape` → `{ partial: boolean, name, price, imageUrl, originalUrl }`
- Consumes: `POST /api/upload-image` → `{ imageUrl: string }`
- Produces: dashboard funcional com campo de imagem editável + upload

- [ ] **Step 1: Adicionar campo fieldImageUrl e input de arquivo no HTML**

Dentro do `#preview .preview-fields`, após o campo de cupom (campo `fieldCoupon`), adicionar:

```html
<div class="field">
  <label>URL da imagem</label>
  <input type="text" id="fieldImageUrl" placeholder="https://..." />
  <div style="margin-top:6px;display:flex;align-items:center;gap:8px">
    <label class="btn" style="background:#f5f5f5;color:#333;border:1px solid #ddd;font-size:0.85rem;padding:6px 12px;cursor:pointer;border-radius:6px">
      📎 Upload de imagem
      <input type="file" id="fileImage" accept="image/jpeg,image/png,image/webp" style="display:none" />
    </label>
    <span id="uploadStatus" style="font-size:0.8rem;color:#666"></span>
  </div>
</div>
```

- [ ] **Step 2: Remover seção Amazon Deals do HTML**

Remover o bloco inteiro:

```html
<!-- Amazon Deals -->
<div class="card">
  <div class="deals-header">
    <h2>🟠 Ofertas Amazon</h2>
  </div>
  <p class="deals-hint" style="border-left-color:#ff9900;background:#fff8f0">🔗 Link de afiliado com sua tag — via promoções do Pelando.</p>
  <ul class="history-list" id="amazonList" style="margin-top:12px">
    <li class="empty">Carregando...</li>
  </ul>
</div>
```

- [ ] **Step 3: Atualizar loadDeals() — remover referências Amazon**

Substituir a função `loadDeals()`:

```javascript
async function loadDeals() {
  console.log('[loadDeals] iniciando...')
  try {
    const [dealsRes, catRes] = await Promise.all([fetch('/api/deals'), fetch('/api/categories')])
    if (!dealsRes.ok) throw new Error(`/api/deals retornou ${dealsRes.status}`)
    if (!catRes.ok) throw new Error(`/api/categories retornou ${catRes.status}`)

    const deals = await dealsRes.json()
    categoryMeta = await catRes.json()

    allDeals = deals.filter(d => d.source === 'shopee')
    console.log('[loadDeals] shopee:', allDeals.length)
    renderTabs()
  } catch (err) {
    console.error('[loadDeals] ERRO:', err)
    $('dealsList').innerHTML = `<li class="empty">Erro ao carregar ofertas: ${err.message}</li>`
  }
}
```

- [ ] **Step 4: Remover função renderAmazon() e referências a amazonList**

Remover a função `renderAmazon(deals) { ... }` inteira do script.

Remover também a linha `$('amazonList').innerHTML = ...` do catch de `loadDeals` (já coberto no Step 3).

- [ ] **Step 5: Adicionar variável currentImageUrl e atualizar getProductData()**

Logo após `const $ = id => document.getElementById(id)`, adicionar:

```javascript
let currentImageUrl = ''

function updateImagePreview(url) {
  if (url) {
    $('previewImg').src = url.startsWith('data:') ? url : `/api/image-proxy?url=${encodeURIComponent(url)}`
  } else {
    $('previewImg').src = ''
  }
}
```

Substituir a função `getProductData()`:

```javascript
function getProductData() {
  return {
    name: $('fieldName').value,
    price: $('fieldPrice').value,
    originalPrice: $('fieldOriginalPrice').value || undefined,
    imageUrl: currentImageUrl || $('fieldImageUrl').value.trim(),
    originalUrl: $('productUrl').value,
  }
}
```

- [ ] **Step 6: Atualizar handler do btnScrape**

Substituir o event listener `$('btnScrape').addEventListener(...)` inteiro:

```javascript
$('btnScrape').addEventListener('click', async () => {
  const url = $('productUrl').value.trim()
  if (!url) return

  $('btnScrape').disabled = true
  showStatus('scrapeStatus', 'loading', 'Buscando dados do produto...')

  try {
    const res = await fetch('/api/scrape', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    })
    const data = await res.json()

    $('fieldName').value = data.name || ''
    $('fieldOriginalPrice').value = data.originalPrice || ''
    $('fieldPrice').value = data.price || ''
    $('fieldCoupon').value = ''
    $('fieldGroupUrl').value = ''

    currentImageUrl = data.imageUrl || ''
    $('fieldImageUrl').value = currentImageUrl
    updateImagePreview(currentImageUrl)

    if (data.partial || !data.name) {
      showStatus('scrapeStatus', 'warning', '⚠️ Dados parciais — complete os campos manualmente.')
    } else {
      hideStatus('scrapeStatus')
    }

    const priceInput = $('fieldPrice')
    if (!data.price) {
      priceInput.classList.add('required-empty')
      priceInput.focus()
    } else {
      priceInput.classList.remove('required-empty')
    }
  } catch (err) {
    showStatus('scrapeStatus', 'error', `❌ ${err.message}`)
  } finally {
    $('btnScrape').disabled = false
    $('preview').style.display = 'block'
  }
})
```

- [ ] **Step 7: Adicionar handler de upload de arquivo**

Logo após o handler do btnScrape, adicionar:

```javascript
// Sync fieldImageUrl manual input → currentImageUrl
$('fieldImageUrl').addEventListener('input', () => {
  currentImageUrl = $('fieldImageUrl').value.trim()
  if (currentImageUrl) updateImagePreview(currentImageUrl)
})

// File upload handler
$('fileImage').addEventListener('change', async (e) => {
  const file = e.target.files?.[0]
  if (!file) return
  if (file.size > 5 * 1024 * 1024) {
    $('uploadStatus').textContent = '❌ Máximo 5MB'
    return
  }
  $('uploadStatus').textContent = '⏳ Enviando...'
  try {
    const base64 = await new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result.split(',')[1])
      reader.onerror = reject
      reader.readAsDataURL(file)
    })
    const res = await fetch('/api/upload-image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: base64, mime: file.type }),
    })
    const json = await res.json()
    if (!res.ok) throw new Error(json.error || 'Erro no upload')
    currentImageUrl = json.imageUrl
    $('fieldImageUrl').value = currentImageUrl
    $('previewImg').src = currentImageUrl
    $('uploadStatus').textContent = '✅ Imagem enviada'
  } catch (err) {
    $('uploadStatus').textContent = `❌ ${err.message}`
  }
})
```

- [ ] **Step 8: Atualizar useDeal() — usar fieldImageUrl e currentImageUrl**

Dentro da função `useDeal`, substituir:

```javascript
$('productUrl').dataset.imageUrl = deal.imageUrl
// ...
$('previewImg').src = deal.imageUrl
```

Por:

```javascript
currentImageUrl = deal.imageUrl || ''
$('fieldImageUrl').value = currentImageUrl
updateImagePreview(currentImageUrl)
```

- [ ] **Step 9: Verificar no browser**

```bash
npm run dev
```

Abrir `http://localhost:3000`. Verificar:
1. Formulário aparece na tela (seção "2. Revise e adicione cupom")
2. Colar URL → clicar "Extrair" → campos preenchidos (ou parcial com aviso)
3. Botão "📎 Upload de imagem" → selecionar arquivo → imagem aparece no preview
4. Campo "URL da imagem" pode ser editado manualmente
5. Seção Amazon NÃO aparece mais
6. Botões "Enviar WhatsApp" e "Enviar Telegram" continuam funcionando

- [ ] **Step 10: Commit**

```bash
git add public/index.html
git commit -m "feat: formulário manual com campo de imagem e upload, remover seção Amazon"
```

---

## Self-Review

**Spec coverage:**

| Requisito | Task |
|---|---|
| Remover scrapeProduct (Playwright) | Task 1 ✓ |
| Remover playwright/playwright-extra/puppeteer-extra-plugin-stealth | Task 1 ✓ |
| Remover PelandoScraper + MercadoLivreScraper + jobs | Task 2 ✓ |
| Remover monitorPelando + monitorML de server.ts | Task 3 ✓ |
| POST /api/scrape usa só quickFetchProduct, nunca 500 | Task 3 ✓ |
| POST /api/upload-image (base64 JSON) | Task 3 ✓ |
| GET /img/upload/:id | Task 3 ✓ |
| temp_images DDL | Task 3 ✓ |
| Dashboard: campo imageUrl editável | Task 4 ✓ |
| Dashboard: upload de imagem | Task 4 ✓ |
| Dashboard: remover seção Amazon | Task 4 ✓ |
| Dashboard: partial response handling | Task 4 ✓ |
| Build + testes passam | Tasks 1-3 ✓ |
