# Phase 01: link-curto-whatsapp — Research

**Researched:** 2026-06-11
**Domain:** Link shortener + WhatsApp OG preview + Postgres on Railway
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01: Postgres no Railway, não JSON file** — pg com índice em `code`, O(1) lookups
- **D-02: `pg` (node-postgres) direto, sem ORM** — 1 tabela, 5 operações simples, queries parametrizadas
- **D-03: `DATABASE_URL` via Railway environment** — Reference Variable `${{Postgres.DATABASE_URL}}`; migração DDL no startup
- **D-04: 4 mitigações de segurança obrigatórias** — SSRF allowlist, validação de affiliateUrl, rate limit 60 req/min/IP, SQL parametrizado
- **D-05: Expiração 45 dias** — `expires_at = created_at + INTERVAL '45 days'`
- **D-06: Expirado → redirect para busca da plataforma com tag de afiliado** (Shopee, Amazon, ML conforme `source`)
- **D-07: Nunca deletar registros** — analytics preservados
- **D-08: Cache in-memory LRU Map 200 entradas + Cache-Control: 24h** — timeout 8s, 502 em falha

**Schema locked:**
```sql
CREATE TABLE IF NOT EXISTS links (
  code        VARCHAR(5)    PRIMARY KEY,
  title       TEXT          NOT NULL,
  image_url   TEXT          NOT NULL,
  affiliate_url TEXT        NOT NULL,
  source      VARCHAR(20)   NOT NULL,
  click_count INTEGER       NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  expires_at  TIMESTAMPTZ   NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_links_code ON links(code);
```

### Claude's Discretion

- Estrutura interna de `src/server/links.ts` (função signatures, error types)
- Caption format do link curto no Telegram (deve conter `ofertas.thaisbonomi.com.br/r/` e não a URL longa)
- Inline button "Abrir oferta" nos deals automáticos pode manter URL direta (não visível no WhatsApp)

### Deferred Ideas (OUT OF SCOPE)

- Subdomínio mais curto (`l.thaisbonomi.com.br`)
- Meta API integration
- Dashboard web de analytics
- Renovação de link expirado
- QR Code
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| REQ-01 | `src/server/links.ts` — módulo de storage Postgres | pg Pool pattern, DDL migration on startup |
| REQ-02 | Gerador de código curto 5 chars alfanumérico sem colisão | `crypto.randomBytes` pattern, retry logic |
| REQ-03 | `GET /r/:code` — HTML com OG tags + meta refresh | OG tag set required by WhatsApp crawler |
| REQ-04 | `GET /img/:code` — proxy de imagem com SSRF allowlist + LRU cache | SSRF allowlist, in-memory Map, Cache-Control |
| REQ-05 | Integração wizard manual (bot.ts `sendToTelegram`) | Integration point at line 75–88 |
| REQ-06 | Integração deals automáticos (`sendDealToChats`, `sendDealCard`) | Integration points at lines 750–766, 795–838 |
| REQ-07 | `GET /api/links` — analytics protegido por auth | Existing auth middleware at line 52 |
</phase_requirements>

---

## Summary

Phase 01 implements a link shortener (`ofertas.thaisbonomi.com.br/r/{code}`) that solves the WhatsApp gallery-save problem by replacing photo sends with OG-tag-bearing redirect pages. The three new endpoints (`/r/:code`, `/img/:code`, `/api/links`) integrate into the existing Express server, and the Telegram bot's three send functions are patched to generate a short link before composing captions.

The storage layer migrates from the JSON file pattern (used by `history.ts`) to Postgres via `pg` (node-postgres) Pool — a locked decision driven by the 5,000 links/month volume. The pool connects via Railway's `DATABASE_URL` reference variable and runs DDL migration at server startup. `express-rate-limit` (v8.x, not currently in package.json) protects the redirect endpoint at 60 req/min/IP.

**Primary recommendation:** Add `pg`, `@types/pg`, and `express-rate-limit` as the only new dependencies. All other capabilities (OG tags via raw HTML string, LRU cache via in-memory Map, short code via `crypto.randomBytes`) require no additional packages.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Short-code storage + click tracking | Database (Postgres/Railway) | — | Durability and O(1) lookup required at 5k/month volume |
| OG tag HTML generation | API / Backend (`/r/:code`) | — | WhatsApp crawler hits server; tags must be in HTML `<head>` |
| Image proxying + SSRF protection | API / Backend (`/img/:code`) | — | Origin CDNs blocked by WhatsApp; proxy on our domain |
| In-memory image cache | API / Backend (process memory) | — | Reduce repeat CDN fetches; acceptable loss on restart |
| Rate limiting | API / Backend (express middleware) | — | Per-IP enforcement at network edge within Express |
| Short link generation | API / Backend (`links.ts`) | Bot (`bot.ts` calls it) | `createLink()` called from bot before caption assembly |
| Caption formatting | Bot (`bot.ts`) | — | Telegram-specific output; WhatsApp reads OG tags, not caption |

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `pg` | 8.21.0 | Postgres client + Pool | Official node-postgres; de facto standard; 13+ years on npm |
| `@types/pg` | 8.20.0 | TypeScript types for pg | DefinitelyTyped; required for TS strict mode |
| `express-rate-limit` | 8.5.2 | Per-IP rate limiting middleware | Official Express ecosystem package; 10+ years on npm |

[VERIFIED: npm registry] — confirmed via `npm view pg version`, `npm view @types/pg version`, `npm view express-rate-limit version`

### Supporting (no new packages needed)

| Capability | Solution | Why No Package |
|------------|----------|----------------|
| OG meta tags | Raw HTML template string in route handler | Static HTML; no template engine needed |
| LRU cache | `Map<string, CacheEntry>` with size check + `Map.keys().next()` eviction | Max 200 entries; no external dep justified |
| Short code generation | `crypto.randomBytes(4).toString('base64url').slice(0,5)` | Node built-in; already used in `shopeeAffiliate.ts` |
| DDL migration | `pool.query('CREATE TABLE IF NOT EXISTS ...')` on startup | One-time idempotent query |

**Installation (new packages only):**
```bash
npm install pg express-rate-limit
npm install --save-dev @types/pg
```

---

## Package Legitimacy Audit

| Package | Registry | Age | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-------------|-----------|-------------|
| `pg` | npm | 13+ yrs (2010-12) | github.com/brianc/node-postgres | [OK] | Approved |
| `@types/pg` | npm | 8+ yrs | github.com/DefinitelyTyped/DefinitelyTyped | [OK] | Approved |
| `express-rate-limit` | npm | 10+ yrs (2014-12) | github.com/express-rate-limit/express-rate-limit | [OK] | Approved |

**Packages removed due to slopcheck [SLOP] verdict:** none
**Packages flagged [SUS]:** none
**postinstall scripts:** none found on any package

---

## Architecture Patterns

### System Architecture Diagram

```
Telegram Bot (bot.ts)
   |
   |── sendToTelegram / sendDealCard / sendDealToChats
   |       |
   |       v
   |   createLink(title, image_url, affiliate_url, source)
   |       |
   |       v
   |   links.ts ──────────────► Postgres (Railway)
   |       |                      table: links
   |       v
   |   returns: code (5-char)
   |       |
   |       v
   |   caption: "...ofertas.thaisbonomi.com.br/r/{code}"
   |
   └─► Telegram sends photo + caption to user

WhatsApp (end user pastes caption)
   |
   └─► GET /r/{code}  ──────────► Postgres lookup
           |                       ├── NOT FOUND → 404 JSON
           |                       ├── EXPIRED → redirect to platform search URL
           |                       └── VALID → increment click_count
           |
           ├── Returns HTML with OG tags
           |     og:title, og:image, og:description, og:url
           |     <meta http-equiv="refresh" content="0;url={affiliate_url}">
           |
           └── WhatsApp crawler reads og:image → GET /img/{code}
                   |
                   ├── code lookup in Postgres
                   ├── LRU Map cache hit → return buffer
                   └── cache miss → axios.get(image_url) with SSRF allowlist
                           |── allowed domain → proxy + cache + return
                           └── blocked domain → 403

GET /api/links
   └── isAuthenticated(req) middleware (existing, line 52)
         ├── 401 if not authed
         └── SELECT ... ORDER BY created_at DESC LIMIT 100
```

### Recommended Project Structure

```
src/
├── server/
│   ├── index.ts          # Add routes: /r/:code, /img/:code, /api/links
│   ├── links.ts          # NEW — pg Pool, createLink, getLink, incrementClick
│   └── history.ts        # Unchanged — JSON file pattern preserved
├── telegram/
│   └── bot.ts            # Patch sendToTelegram, sendDealCard, sendDealToChats
```

### Pattern 1: pg Pool with Railway DATABASE_URL

```typescript
// Source: https://node-postgres.com/apis/pool
import { Pool } from 'pg'

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,                     // Railway free tier: 25 max_connections; 10 is safe
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
})

// DDL migration on startup — idempotent
export async function initLinksTable(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS links (
      code          VARCHAR(5)   PRIMARY KEY,
      title         TEXT         NOT NULL,
      image_url     TEXT         NOT NULL,
      affiliate_url TEXT         NOT NULL,
      source        VARCHAR(20)  NOT NULL,
      click_count   INTEGER      NOT NULL DEFAULT 0,
      created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
      expires_at    TIMESTAMPTZ  NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_links_code ON links(code);
  `)
}
```

[CITED: node-postgres.com/apis/pool] — `connectionString` accepts full URL; `max` default is 10.

### Pattern 2: Short Code Generation (crypto built-in)

```typescript
// Source: Node.js built-in crypto (no import needed in ESM — use named import)
import { randomBytes } from 'crypto'

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'

function generateCode(): string {
  // 4 random bytes → 8 hex chars → slice 5: collision probability negligible at 60k/yr
  // Alternative: base62 via modulo for uniform distribution
  const bytes = randomBytes(4)
  let code = ''
  for (let i = 0; i < 5; i++) {
    code += ALPHABET[bytes[i % 4] % ALPHABET.length]
  }
  return code
}

async function generateUniqueCode(): Promise<string> {
  for (let attempt = 0; attempt < 10; attempt++) {
    const code = generateCode()
    const { rows } = await pool.query('SELECT 1 FROM links WHERE code = $1', [code])
    if (rows.length === 0) return code
  }
  throw new Error('Could not generate unique code after 10 attempts')
}
```

**Note:** 62^5 = 916 million possible codes. At 60k/year, collision probability after 1M inserts is ~0.05%. The 10-attempt retry is a pure safety net.

### Pattern 3: OG Tags HTML for WhatsApp

```typescript
// Source: WhatsApp OG requirements (verified via multiple current sources)
// Required tags: og:title, og:image, og:description, og:url + meta refresh
function buildOGPage(link: LinkEntry, baseUrl: string): string {
  const imgUrl = `${baseUrl}/img/${link.code}`
  const canonicalUrl = `${baseUrl}/r/${link.code}`
  const desc = `${link.source.charAt(0).toUpperCase() + link.source.slice(1)} — Clique para ver a oferta`

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta property="og:title" content="${esc(link.title)}" />
  <meta property="og:image" content="${imgUrl}" />
  <meta property="og:description" content="${esc(desc)}" />
  <meta property="og:url" content="${canonicalUrl}" />
  <meta property="og:type" content="website" />
  <meta http-equiv="refresh" content="0;url=${link.affiliate_url}" />
  <title>${esc(link.title)}</title>
</head>
<body>
  <p>Redirecionando para a oferta...</p>
  <script>window.location.href = ${JSON.stringify(link.affiliate_url)};</script>
</body>
</html>`
}
```

**Critical WhatsApp crawler requirements:**
- Response must arrive within ~3 seconds (WhatsApp has aggressive crawl timeout) [CITED: opengraphplus.com/consumers/whatsapp]
- `og:image` URL must be HTTPS and reachable without auth
- WhatsApp crawlers: `WhatsApp/2.x`, `facebookexternalhit/1.1`, `Facebot` — do NOT block these in any middleware
- Image: recommended 1200×630px; max 600KB; min 100×100px [CITED: opengraphplus.com/consumers/whatsapp/images]
- Page must NOT block crawlers in `robots.txt`

### Pattern 4: SSRF Allowlist for /img/:code

```typescript
// LOCKED per D-04
const ALLOWED_IMAGE_HOSTS = [
  /\.shopee\.com\.br$/,
  /\.szcdn\.com$/,
  /\.ssl-images-amazon\.com$/,
  /\.cloudfront\.net$/,
  /\.mlstatic\.com$/,
]

function isSsrfAllowed(imageUrl: string): boolean {
  try {
    const { hostname } = new URL(imageUrl)
    return ALLOWED_IMAGE_HOSTS.some(re => re.test(hostname))
  } catch {
    return false
  }
}
```

### Pattern 5: In-Memory LRU Map (200 entries)

```typescript
// LOCKED per D-08 — no external dependency needed
interface ImageCacheEntry { buffer: Buffer; contentType: string; cachedAt: number }
const imageCache = new Map<string, ImageCacheEntry>()
const IMAGE_CACHE_MAX = 200

function lruSet(code: string, entry: ImageCacheEntry): void {
  if (imageCache.size >= IMAGE_CACHE_MAX) {
    // Map preserves insertion order; first key is oldest
    imageCache.delete(imageCache.keys().next().value)
  }
  imageCache.set(code, entry)
}
```

### Pattern 6: express-rate-limit Configuration

```typescript
// Source: https://express-rate-limit.mintlify.app/reference/configuration
// v7/v8: use 'limit' (not deprecated 'max'); windowMs 60_000; per-IP by default
import rateLimit from 'express-rate-limit'

const redirectLimiter = rateLimit({
  windowMs: 60_000,          // 1 minute
  limit: 60,                  // 60 requests per minute per IP (locked D-04)
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Too many requests' },
})

app.get('/r/:code', redirectLimiter, async (req, res) => { ... })
```

**Important:** `express-rate-limit` v7+ uses `limit` (not `max`). `max` still works but is deprecated. [CITED: express-rate-limit.mintlify.app/reference/configuration]

### Pattern 7: Expired Link Redirect URLs (D-06)

```typescript
// Affiliate search URL construction — uses source from DB
const BASE_URL_PATTERNS: Record<string, (title: string) => string> = {
  shopee: (t) => `https://shopee.com.br/search?keyword=${encodeURIComponent(t)}`,
  amazon: (t) => `https://www.amazon.com.br/s?k=${encodeURIComponent(t)}&tag=${process.env.AMAZON_TAG || ''}`,
  ml:     (t) => `https://www.mercadolivre.com.br/jm/search?as_word=${encodeURIComponent(t)}&matt_tool=${process.env.ML_PUBLISHER_ID || ''}&matt_word=${process.env.ML_MATT_WORD || ''}`,
}
// Note: ML env vars PUBLISHER_ID and MATT_WORD are in mercadoLivreAffiliate.ts — must expose or import
```

### Anti-Patterns to Avoid

- **String concatenation in SQL:** Never `WHERE code = '${code}'` — always `WHERE code = $1` with params
- **Sharing single pg.Client:** Use Pool, not Client directly — Pool handles reconnection automatically
- **Blocking WhatsApp crawlers:** The existing auth middleware excludes `/api/login` and `/api/test-ml`. Ensure `/r/:code` and `/img/:code` are NOT under the `/api` auth middleware (they aren't `/api/*` paths, so this is safe — but verify route registration order)
- **Returning redirect (301/302) before OG read:** WhatsApp reads OG tags from the *response to the URL pasted*, not the redirect target. The `/r/:code` handler must return 200 HTML with OG tags + meta refresh, NOT a 30x redirect. [CITED: multiple WhatsApp preview guides]
- **URL-encoded OG content attribute:** Use `esc()` (HTML entity encoding) for `content=""` attributes, not URL encoding

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Per-IP rate limiting | Custom IP counter + setInterval reset | `express-rate-limit` | Handles IPv6, headers, distributed reset edge cases |
| Postgres connection management | Manual `pg.Client` per request | `pg.Pool` | Pool handles reconnect, idle eviction, max-conn enforcement |
| SSRF detection | String.includes() on URL | `new URL(url).hostname` + regex test | URL parsing correctly handles auth@ prefixes and ports |

**Key insight:** The image proxy and LRU cache ARE hand-rolled but intentionally — the requirements are specific (200-entry limit, code-keyed not URL-keyed, SSRF allowlist) and no library maps cleanly.

---

## Common Pitfalls

### Pitfall 1: /r/:code must return 200, not 3xx
**What goes wrong:** Handler uses `res.redirect(affiliateUrl)` — WhatsApp crawler follows the redirect, reaches the affiliate page, finds no OG tags → no preview.
**Why it happens:** Intuitive interpretation of "redirect endpoint."
**How to avoid:** Return `res.status(200).type('html').send(buildOGPage(...))` with `<meta http-equiv="refresh">`. WhatsApp reads the 200 response's OG tags before the browser executes the meta refresh.
**Warning signs:** WhatsApp shows only the URL, no preview card.

### Pitfall 2: /img/:code route must NOT fall under Express auth middleware
**What goes wrong:** If `/img/:code` is registered after the `app.use('/api', ...)` middleware in the wrong file scope, auth could bleed. More dangerous: if `isAuthenticated` check is accidentally applied to `/r/:code`, WhatsApp crawler gets 401.
**Why it happens:** Routes in `index.ts` are order-sensitive. The auth middleware is `app.use('/api', ...)` which only matches `/api/*` — so `/r/:code` and `/img/:code` are safe AS LONG AS they are not placed inside a `Router` that is mounted under `/api`.
**How to avoid:** Register `/r/:code`, `/img/:code` directly on `app`, not under any `/api` mount. Verify order: auth middleware before these routes is fine; mounting these *inside* `/api` router is not.
**Warning signs:** Preview fails with 401; curl on `/img/:code` returns 401.

### Pitfall 3: Railway Postgres free tier connection limit
**What goes wrong:** Default `pg.Pool` max is 10; Railway free-tier Postgres default `max_connections` is 25. With multiple dyno restarts or concurrent pools, connection exhaustion causes `connection timeout` errors.
**Why it happens:** Railway provisions shared Postgres with limited connections.
**How to avoid:** Set `pool.max = 5` for Railway hobby tier, or `max = 10` for pro. Call `await pool.end()` on `SIGTERM` to release connections on deploy.
**Warning signs:** `connection timeout` errors in Railway logs after deploys.

### Pitfall 4: WhatsApp caches previews aggressively
**What goes wrong:** After changing OG tags on an existing code, WhatsApp still shows old preview.
**Why it happens:** WhatsApp caches OG metadata per URL for hours to days. [CITED: opengraphplus.com/consumers/whatsapp/caching]
**How to avoid:** Since codes are immutable (D-07: never delete, and link editing is out of scope), this is not a concern for this phase. Document for future reference.
**Warning signs:** Updated link data not reflected in new sends (won't happen here).

### Pitfall 5: og:image must be absolute HTTPS URL
**What goes wrong:** `og:image` set to `/img/xK3mP` (relative) — WhatsApp can't resolve it.
**Why it happens:** Relative URLs work in browsers but not in crawler contexts.
**How to avoid:** Build absolute URL using `process.env.BASE_URL` or `req.protocol + '://' + req.get('host')`. Railway sets `x-forwarded-proto: https` — use that for protocol detection.
**Warning signs:** Preview shows title only, no image.

### Pitfall 6: Bot.ts integration — async createLink in sendDealToChats loop
**What goes wrong:** `sendDealToChats` already has a 60-second delay between chats (line 757). If `createLink()` fails (DB unreachable), the whole send loop throws and no deal is sent.
**Why it happens:** Unhandled async errors propagate.
**How to avoid:** Wrap `createLink()` in try/catch; on failure, fall back to using `dealUrl` directly (long URL) with a console warning. Preview degrades gracefully — user still gets the deal, just without OG preview.
**Warning signs:** Deals stop sending when Railway DB is cold-starting.

---

## Code Examples

### createLink function signature

```typescript
// src/server/links.ts
export interface LinkEntry {
  code: string
  title: string
  image_url: string
  affiliate_url: string
  source: 'shopee' | 'amazon' | 'ml'
  click_count: number
  created_at: Date
  expires_at: Date
}

export async function createLink(data: {
  title: string
  image_url: string
  affiliate_url: string
  source: 'shopee' | 'amazon' | 'ml'
}): Promise<LinkEntry> {
  const code = await generateUniqueCode()
  const { rows } = await pool.query<LinkEntry>(
    `INSERT INTO links (code, title, image_url, affiliate_url, source, expires_at)
     VALUES ($1, $2, $3, $4, $5, NOW() + INTERVAL '45 days')
     RETURNING *`,
    [code, data.title, data.image_url, data.affiliate_url, data.source]
  )
  return rows[0]
}

export async function getLink(code: string): Promise<LinkEntry | null> {
  const { rows } = await pool.query<LinkEntry>(
    'SELECT * FROM links WHERE code = $1',
    [code]
  )
  return rows[0] ?? null
}

export async function incrementClick(code: string): Promise<void> {
  await pool.query(
    'UPDATE links SET click_count = click_count + 1 WHERE code = $1',
    [code]
  )
}
```

### Bot integration — patch sendToTelegram (REQ-05)

```typescript
// src/telegram/bot.ts — BEFORE the existing sendToTelegram (line 75)
// Import at top: import { createLink } from '../server/links.js'

async function sendToTelegram(ctx: Ctx, product: ProductData, coupon: string) {
  const groupUrl = process.env.WHATSAPP_GROUP_URL || ''

  // Generate short link
  let shortUrl = product.originalUrl
  try {
    const source = detectSource(product.originalUrl)  // 'shopee' | 'amazon' | 'ml'
    const link = await createLink({
      title: product.name,
      image_url: product.imageUrl ?? '',
      affiliate_url: product.originalUrl,
      source,
    })
    shortUrl = `${process.env.BASE_URL}/r/${link.code}`
  } catch (err) {
    console.warn('[links] createLink failed, using original URL:', err)
  }

  const text = buildTelegramText({ ...product, originalUrl: shortUrl }, coupon, groupUrl)

  if (product.imageUrl) {
    try {
      await ctx.replyWithPhoto(product.imageUrl, { caption: text })
      return
    } catch { /* fallback */ }
  }
  await ctx.reply(text)
}
```

### /r/:code route handler skeleton

```typescript
// src/server/index.ts — add BEFORE the /api/* middleware registration (or at least not inside it)
app.get('/r/:code', redirectLimiter, async (req, res) => {
  const { code } = req.params
  const link = await getLink(code)

  if (!link) return res.status(404).json({ error: 'Link não encontrado' })

  const now = new Date()
  if (now > link.expires_at) {
    const searchUrl = buildExpiredRedirectUrl(link.source, link.title)
    return res.redirect(302, searchUrl)
  }

  // Fire-and-forget click increment (non-blocking)
  incrementClick(code).catch(err => console.warn('[links] incrementClick error:', err))

  const baseUrl = `${req.protocol === 'http' && req.headers['x-forwarded-proto'] === 'https' ? 'https' : req.protocol}://${req.get('host')}`
  res.status(200).type('html').send(buildOGPage(link, baseUrl))
})
```

---

## State of the Art

| Old Approach | Current Approach | Impact |
|--------------|------------------|--------|
| `express-rate-limit` v6 `max` option | v8 uses `limit` (backward-compatible) | Use `limit` in new code; `max` still works |
| `pg` Client per request | `pg.Pool` (standard since v7) | Always use Pool in long-running servers |
| `robots.txt` blocking crawlers | Explicitly allow WhatsApp/Meta crawlers | Preview fails silently if blocked |

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Railway free-tier Postgres has 25 max_connections | Pitfall 3 | Could be lower; set pool.max conservatively (5-10) |
| A2 | ML env vars `PUBLISHER_ID` and `MATT_WORD` accessible from `mercadoLivreAffiliate.ts` constants | Pattern 7 | Expired redirect URLs missing affiliate tag; check actual env var names |
| A3 | `process.env.BASE_URL` is set in Railway for `ofertas.thaisbonomi.com.br` | Pattern 5 | OG image URL will be wrong; must ensure BASE_URL env var exists |
| A4 | Shopee affiliate tag for search URL is available (env var or constant) | Pattern 7 | Expired redirect won't carry affiliate tag for Shopee |

---

## Open Questions

1. **BASE_URL environment variable**
   - What we know: `process.env.WHATSAPP_GROUP_URL` is referenced in bot.ts; Railway domain is `ofertas.thaisbonomi.com.br`
   - What's unclear: Is there a `BASE_URL` or `PUBLIC_URL` env var already set on Railway?
   - Recommendation: Add `BASE_URL=https://ofertas.thaisbonomi.com.br` to Railway env vars and `.env.example`

2. **ML PUBLISHER_ID and MATT_WORD for expired redirect**
   - What we know: `mercadoLivreAffiliate.ts` uses `PUBLISHER_ID` and `MATT_WORD` as module-level constants (not exported)
   - What's unclear: Whether these should be exported or the search URL construction should live in that module
   - Recommendation: Export a `buildMLSearchUrl(title: string): string` function from `mercadoLivreAffiliate.ts`

3. **Shopee affiliate tag for search URL**
   - What we know: Shopee affiliate uses `generateAffiliateLink()` for product URLs; search URL with tag has different shape
   - What's unclear: What tag parameter to append to Shopee search for affiliate attribution
   - Recommendation: Check Shopee affiliate docs for search URL attribution; fall back to untagged search if not available

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | All runtime | Yes | v24.14.1 | — |
| `pg` package | REQ-01 to REQ-07 | Not yet installed | 8.21.0 (npm) | — |
| `express-rate-limit` | REQ-03 (rate limit) | Not yet installed | 8.5.2 (npm) | — |
| PostgreSQL (local) | Dev/testing | Not found locally | — | Use Railway DB URL directly in local .env |
| Railway Postgres service | Production + dev | Must be provisioned | — | Provision via Railway Dashboard → New Service → Database → PostgreSQL |

**Missing dependencies with no fallback:**
- Railway Postgres service must be manually provisioned before running DDL migration
- `BASE_URL` env var must be added to Railway + local `.env`

**Missing dependencies with fallback:**
- Local Postgres not required — connect directly to Railway dev DB via `DATABASE_URL` in `.env`

---

## Validation Architecture

> config.json has no `workflow.nyquist_validation` key — treated as enabled.

### Test Framework

| Property | Value |
|----------|-------|
| Framework | None detected — no jest.config, vitest.config, or test directory |
| Config file | None — Wave 0 must create |
| Quick run command | `npx vitest run --reporter=verbose` (after Wave 0 setup) |
| Full suite command | `npx vitest run` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| REQ-01 | `initLinksTable()` creates table idempotently | integration | `vitest run tests/links.test.ts` | Wave 0 |
| REQ-02 | 1000 `generateCode()` calls — all unique, all 5-char | unit | `vitest run tests/links.test.ts` | Wave 0 |
| REQ-03 | `GET /r/:code` returns 200 HTML with og:title, og:image, meta refresh | integration | `vitest run tests/routes.test.ts` | Wave 0 |
| REQ-03 | `GET /r/XXXXX` returns 404 | integration | `vitest run tests/routes.test.ts` | Wave 0 |
| REQ-04 | `GET /img/:code` returns 200 image Content-Type | integration | `vitest run tests/routes.test.ts` | Wave 0 |
| REQ-04 | SSRF-blocked domain returns 403 | unit | `vitest run tests/links.test.ts` | Wave 0 |
| REQ-05 | Caption contains `ofertas.thaisbonomi.com.br/r/` after wizard confirm | manual | Manual Telegram test | — |
| REQ-06 | Auto deal caption contains short link | manual | Manual send to test chat | — |
| REQ-07 | `GET /api/links` without auth → 401 | integration | `vitest run tests/routes.test.ts` | Wave 0 |
| REQ-07 | `GET /api/links` with auth → array | integration | `vitest run tests/routes.test.ts` | Wave 0 |

### Wave 0 Gaps

- [ ] `tests/links.test.ts` — unit tests for generateCode, SSRF allowlist, createLink
- [ ] `tests/routes.test.ts` — integration tests for /r/:code, /img/:code, /api/links
- [ ] `vitest.config.ts` — test framework config (project uses ESM + tsx, vitest works natively)
- [ ] Install: `npm install --save-dev vitest`

---

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | Yes (analytics endpoint) | Existing cookie-HMAC auth middleware (line 52) |
| V4 Access Control | Yes | `/api/links` protected; `/r/:code` and `/img/:code` public intentionally |
| V5 Input Validation | Yes | `new URL()` for SSRF check; parameterized SQL; affiliateUrl domain allowlist |
| V6 Cryptography | No | No crypto operations in this phase beyond short-code generation (uses `crypto.randomBytes`) |
| V10 SSRF | Yes | Hostname regex allowlist on `/img/:code` proxy |

### Known Threat Patterns

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| SSRF via image proxy | Elevation of Privilege | Hostname allowlist — 5 domains locked in D-04 |
| Open redirect abuse | Spoofing | affiliateUrl domain allowlist on `createLink` (locked D-04) |
| Click count inflation | Tampering | Rate limit 60/min/IP on `/r/:code` (locked D-04) |
| SQL injection in code lookup | Tampering | Parameterized queries `WHERE code = $1` (locked D-04) |
| Brute-force code enumeration | Info Disclosure | Rate limit prevents enumeration; 62^5 space makes it impractical |

---

## Sources

### Primary (HIGH confidence)
- [node-postgres.com/apis/pool](https://node-postgres.com/apis/pool) — Pool constructor options, connectionString, max
- [express-rate-limit.mintlify.app/reference/configuration](https://express-rate-limit.mintlify.app/reference/configuration) — v7/v8 `limit` vs `max` option
- [opengraphplus.com/consumers/whatsapp](https://opengraphplus.com/consumers/whatsapp) — WhatsApp OG tags, crawlers, timeout
- [opengraphplus.com/consumers/whatsapp/images](https://opengraphplus.com/consumers/whatsapp/images) — Image dimension requirements
- npm registry — pg@8.21.0, express-rate-limit@8.5.2, @types/pg@8.20.0 (all verified via `npm view`)

### Secondary (MEDIUM confidence)
- [railway.com/blog/database-connection-pooling](https://blog.railway.com/p/database-connection-pooling) — Railway-specific pool sizing recommendations
- [share-preview.com/blog/whatsapp-link-preview](https://share-preview.com/blog/whatsapp-link-preview) — WhatsApp 200-not-302 behavior

### Tertiary (LOW confidence / training knowledge)
- Railway free-tier max_connections = 25 [ASSUMED] — verify in Railway console after provisioning

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — npm registry verified, slopcheck clean, official docs consulted
- Architecture: HIGH — derived directly from locked decisions in CONTEXT.md
- Pitfalls: HIGH (route ordering, crawler blocking, 200 not 302) — medium (Railway connection limits assumed)

**Research date:** 2026-06-11
**Valid until:** 2026-07-11 (stable ecosystem; Railway Postgres API unlikely to change)
