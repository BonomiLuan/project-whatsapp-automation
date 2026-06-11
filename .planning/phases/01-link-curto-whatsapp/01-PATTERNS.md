# Phase 01: link-curto-whatsapp — Pattern Map

**Mapped:** 2026-06-11
**Files analyzed:** 4 (1 new, 3 modified)
**Analogs found:** 4 / 4

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `src/server/links.ts` | service/storage | CRUD + request-response | `src/server/history.ts` | role-match (same module shape, different storage) |
| `src/server/index.ts` | route registrar | request-response | `src/server/index.ts` lines 333–351 (`/api/image-proxy`) | exact — add new routes to same file |
| `src/telegram/bot.ts` | bot handler | event-driven | `src/telegram/bot.ts` lines 795–838 (`sendDealCard`) | exact — patch 3 existing functions |
| `src/api/mercadoLivreAffiliate.ts` | utility | transform | `src/api/mercadoLivreAffiliate.ts` lines 100–117 (`injectMLTag`) | exact — export new function from same module |

---

## Pattern Assignments

### `src/server/links.ts` (service/storage, CRUD)

**Analog:** `src/server/history.ts`

**Imports pattern** (`history.ts` lines 1–6):
```typescript
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
```

For `links.ts`, replace FS imports with pg and crypto:
```typescript
import { Pool } from 'pg'
import { randomBytes } from 'crypto'
```

**Interface pattern** (`history.ts` lines 8–15):
```typescript
export interface HistoryEntry {
  id: string
  sentAt: string
  productName: string
  price: string
  imageUrl: string
  affiliateUrl: string
}
```

For `links.ts`, mirror this export-first style with `LinkEntry` (schema from CONTEXT.md D-01).

**Core function pattern** (`history.ts` lines 26–36):
```typescript
export function appendHistory(entry: Omit<HistoryEntry, 'id' | 'sentAt'>): HistoryEntry {
  const history = loadHistory()
  const newEntry: HistoryEntry = {
    id: Date.now().toString(),
    sentAt: new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }),
    ...entry,
  }
  history.unshift(newEntry)
  writeFileSync(HISTORY_FILE, JSON.stringify(history.slice(0, 50), null, 2))
  return newEntry
}
```

For `links.ts`, the same "insert + return full row" shape maps to:
```typescript
export async function createLink(data: { title: string; image_url: string; affiliate_url: string; source: 'shopee' | 'amazon' | 'ml' }): Promise<LinkEntry> {
  const code = await generateUniqueCode()
  const { rows } = await pool.query<LinkEntry>(
    `INSERT INTO links (code, title, image_url, affiliate_url, source, expires_at)
     VALUES ($1, $2, $3, $4, $5, NOW() + INTERVAL '45 days')
     RETURNING *`,
    [code, data.title, data.image_url, data.affiliate_url, data.source]
  )
  return rows[0]
}
```

**Error handling pattern** (`history.ts` lines 19–23 in `loadHistory`):
```typescript
try {
  return JSON.parse(readFileSync(HISTORY_FILE, 'utf-8'))
} catch {
  return []
}
```

Mirror this silent-catch-with-fallback in `getLink` and `incrementClick`. For `createLink`, propagate the error (caller in bot.ts wraps it).

**Pool shutdown pattern** — no existing analog; add to `links.ts`:
```typescript
process.on('SIGTERM', () => pool.end())
```

---

### `src/server/index.ts` — new routes (route registrar, request-response)

**Analog:** `src/server/index.ts` lines 332–351 (`/api/image-proxy`)

**Imports to add** (after existing imports at lines 1–16):
```typescript
import { createLink, getLink, incrementClick, initLinksTable } from './links.js'
import rateLimit from 'express-rate-limit'
```

**Route registration pattern** (`index.ts` lines 332–351):
```typescript
app.get('/api/image-proxy', async (req, res) => {
  const url = req.query.url as string
  if (!url) return res.status(400).send('URL required')
  try {
    const response = await axios.get(url, {
      responseType: 'arraybuffer',
      timeout: 10000,
      headers: { 'User-Agent': '...', Referer: 'https://shopee.com.br/' },
    })
    res.set('Content-Type', (response.headers['content-type'] as string) || 'image/jpeg')
    res.set('Cache-Control', 'public, max-age=3600')
    res.send(response.data)
  } catch {
    res.status(502).send('Erro ao buscar imagem')
  }
})
```

Copy this `axios.get → responseType:'arraybuffer' → res.set(Content-Type) → res.send(buffer)` shape for `/img/:code`. Change `max-age=3600` to `max-age=86400` (D-08). Add SSRF check before `axios.get`.

**Auth middleware pattern** (`index.ts` lines 52–56):
```typescript
app.use('/api', (req, res, next) => {
  if (req.path === '/login' || req.path === '/test-ml') return next()
  if (!isAuthenticated(req)) return res.status(401).json({ error: 'Não autorizado' })
  next()
})
```

`/r/:code` and `/img/:code` must be registered on `app` directly, NOT inside an `/api` sub-router. Register them before or after the `/api` middleware — either position is safe because those paths do not start with `/api`. `GET /api/links` is automatically protected by the existing middleware above (no whitelist entry needed, just register the route under `/api`).

**Rate limiter registration pattern** (new, follows Express middleware convention):
```typescript
const redirectLimiter = rateLimit({
  windowMs: 60_000,
  limit: 60,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Too many requests' },
})
app.get('/r/:code', redirectLimiter, async (req, res) => { ... })
```

**DDL migration at startup** (`index.ts` lines 416–422 — `app.listen` callback):
```typescript
app.listen(PORT, () => {
  console.log(`\n✅ Servidor rodando em http://localhost:${PORT}`)
  createBot()
  refreshDeals()
  cron.schedule(...)
  cron.schedule(...)
})
```

Add `initLinksTable().catch(console.error)` inside this callback, alongside the existing `createBot()` and `refreshDeals()` calls.

---

### `src/telegram/bot.ts` — patch 3 send functions (bot handler, event-driven)

**Analog:** `src/telegram/bot.ts` lines 795–838 (`sendDealCard`)

**Import to add** (after existing imports at lines 1–11):
```typescript
import { createLink } from '../server/links.js'
```

**Integration point 1 — `sendToTelegram`** (lines 75–88):
```typescript
async function sendToTelegram(ctx: Ctx, product: ProductData, coupon: string) {
  const groupUrl = process.env.WHATSAPP_GROUP_URL || ''
  const text = buildTelegramText(product, coupon, groupUrl)  // ← currently uses product.originalUrl

  if (product.imageUrl) {
    try {
      await ctx.replyWithPhoto(product.imageUrl, { caption: text })
      return
    } catch { /* fallback to text if image fails */ }
  }
  await ctx.reply(text)
}
```

Patch: generate short link before `buildTelegramText`, wrap in try/catch with fallback per Pitfall 6:
```typescript
let shortUrl = product.originalUrl
try {
  const link = await createLink({
    title: product.name,
    image_url: product.imageUrl ?? '',
    affiliate_url: product.originalUrl,
    source: detectSource(product.originalUrl),
  })
  shortUrl = `${process.env.BASE_URL}/r/${link.code}`
} catch (err) {
  console.warn('[links] createLink failed, using original URL:', err)
}
const text = buildTelegramText({ ...product, originalUrl: shortUrl }, coupon, groupUrl)
```

**Integration point 2 — `sendProductToChat`** (lines 769–790):
```typescript
export async function sendProductToChat(product: ProductData, coupon: string): Promise<void> {
  const chatIds = getTargetChatIds()
  // ...
  const groupUrl = process.env.WHATSAPP_GROUP_URL || ''
  const text = buildTelegramText(product, coupon, groupUrl)  // ← uses product.originalUrl
  // ...
}
```

Apply same short-link-before-text pattern as point 1.

**Integration point 3 — `sendDealToChats`** (lines 720–766, contains the `dealUrl` variable):
```typescript
let dealUrl = deal.affiliateUrl
// ...
const text = formatMessage({ ..., buyUrl: dealUrl, ... })
```

Patch: after `dealUrl` is finalized (after the Shopee re-tag block), generate short link:
```typescript
let shortUrl = dealUrl
try {
  const link = await createLink({
    title: deal.title,
    image_url: deal.imageUrl,
    affiliate_url: dealUrl,
    source: deal.source === 'mercado-livre' ? 'ml' : deal.source as 'shopee' | 'amazon',
  })
  shortUrl = `${process.env.BASE_URL}/r/${link.code}`
} catch (err) {
  console.warn('[links] createLink failed for auto deal:', err)
}
const text = formatMessage({ ..., buyUrl: shortUrl, ... })
```

**`sendDealCard` also needs same patch** (lines 795–838) — it uses `dealUrl` in `formatMessage` and the inline button. Patch `buyUrl` in `formatMessage` with `shortUrl`, but keep `dealUrl` in the inline button (`Markup.button.url`) since that button is Telegram-only and not visible on WhatsApp:
```typescript
const buttons = Markup.inlineKeyboard([[
  Markup.button.url('🛒 Abrir oferta', dealUrl),  // ← keep long URL for direct click
  Markup.button.callback('📲 WhatsApp', `wa:${deal.id}`),
]])
// text uses shortUrl; button keeps dealUrl
```

**`detectSource` helper** (new utility needed in bot.ts):
```typescript
function detectSource(url: string): 'shopee' | 'amazon' | 'ml' {
  if (url.includes('shopee')) return 'shopee'
  if (url.includes('amazon') || url.includes('amzn')) return 'amazon'
  return 'ml'
}
```

---

### `src/api/mercadoLivreAffiliate.ts` — export `buildMLSearchUrl` (utility, transform)

**Analog:** `src/api/mercadoLivreAffiliate.ts` lines 100–117 (`injectMLTag`)

**Existing constants** (lines 3–4):
```typescript
const PUBLISHER_ID = process.env.ML_PUBLISHER_ID ?? '64897511'
const MATT_WORD = process.env.ML_MATT_WORD ?? 'mamaeeconomica'
```

These are already module-level but not exported. The new `buildMLSearchUrl` export uses them directly:
```typescript
export function buildMLSearchUrl(title: string): string {
  return `https://www.mercadolivre.com.br/jm/search?as_word=${encodeURIComponent(title)}&matt_tool=${PUBLISHER_ID}&matt_word=${MATT_WORD}`
}
```

Pattern mirrors how `injectMLTag` uses `PUBLISHER_ID` and `MATT_WORD` inline without re-importing them.

---

## Shared Patterns

### Authentication (protect `GET /api/links`)
**Source:** `src/server/index.ts` lines 52–56
**Apply to:** `GET /api/links` route — no changes needed, the existing `app.use('/api', ...)` middleware already protects all `/api/*` routes except `/login` and `/test-ml`. Register `/api/links` within the same `app` and it is automatically protected.

### Error handling — async route handlers
**Source:** `src/server/index.ts` lines 202–213 (`/api/scrape`):
```typescript
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

**Apply to:** `/r/:code`, `/img/:code`, `/api/links` — use same `try/catch`, `err instanceof Error ? err.message : '...'`, `console.error('[tag]', message)` pattern.

### Image proxy pattern
**Source:** `src/server/index.ts` lines 333–351 (`/api/image-proxy`):
```typescript
const response = await axios.get(url, {
  responseType: 'arraybuffer',
  timeout: 10000,
  headers: { 'User-Agent': 'Mozilla/5.0 ...', Referer: 'https://shopee.com.br/' },
})
res.set('Content-Type', (response.headers['content-type'] as string) || 'image/jpeg')
res.set('Cache-Control', 'public, max-age=3600')
res.send(response.data)
```

**Apply to:** `/img/:code` — copy this shape, change timeout to 8000 (D-08), change `max-age` to `86400` (D-08), add SSRF allowlist check before `axios.get`.

### Bot try/catch-with-fallback pattern
**Source:** `src/telegram/bot.ts` lines 829–837 (`sendDealCard`):
```typescript
try {
  if (deal.imageUrl) {
    await ctx.replyWithPhoto(deal.imageUrl, { caption: text, ...buttons })
  } else {
    await ctx.reply(text, buttons)
  }
} catch {
  await ctx.reply(text, buttons)
}
```

**Apply to:** All `createLink()` call sites in bot.ts — wrap in try/catch, on failure use original URL directly. Never let a `createLink` failure propagate and break the send loop.

### ESM import convention
**Source:** `src/telegram/bot.ts` lines 1–11 — all imports use `.js` extension in specifiers:
```typescript
import { scrapeProduct, quickFetchProduct, type ProductData } from '../scraper/productScraper.js'
import { appendHistory, loadHistory } from './history.js'
```

**Apply to:** All new imports in `bot.ts` and `index.ts` — use `.js` extension: `'../server/links.js'`, `'./links.js'`.

---

## No Analog Found

All 4 files have analogs. The following capabilities within `links.ts` are novel (no codebase analog) — use RESEARCH.md patterns instead:

| Capability | Pattern Source |
|---|---|
| pg Pool initialization | RESEARCH.md Pattern 1 |
| Short code generation with retry | RESEARCH.md Pattern 2 |
| OG tag HTML builder (`buildOGPage`) | RESEARCH.md Pattern 3 |
| SSRF allowlist (`isSsrfAllowed`) | RESEARCH.md Pattern 4 |
| LRU Map cache (`lruSet`) | RESEARCH.md Pattern 5 |
| Expired link search URL builder | RESEARCH.md Pattern 7 |

---

## Metadata

**Analog search scope:** `src/server/`, `src/telegram/`, `src/api/`
**Files scanned:** 4 source files fully read
**Pattern extraction date:** 2026-06-11
