---
phase: 01-link-curto-whatsapp
plan: "04"
subsystem: telegram-bot
tags: [telegram, short-link, affiliate, og-preview, whatsapp, bot]

dependency_graph:
  requires:
    - phase: 01-link-curto-whatsapp
      plan: "02"
      provides: "createLink() function in src/server/links.ts"
    - phase: 01-link-curto-whatsapp
      plan: "03"
      provides: "GET /r/:code OG redirect route serving WhatsApp preview HTML"
  provides:
    - "All 4 Telegram send functions generate short links before composing captions"
    - "detectSource() helper routing Shopee/Amazon/ML URLs to correct source enum"
    - "buildMLSearchUrl() exported from mercadoLivreAffiliate.ts for expired-redirect fallback"
    - ".env.example documents DATABASE_URL, BASE_URL, AMAZON_TAG"
  affects: [src/telegram/bot.ts, src/api/mercadoLivreAffiliate.ts, .env.example]

tech-stack:
  added: []
  patterns:
    - "try/catch fallback: createLink failure degrades gracefully — send proceeds with original URL"
    - "detectSource URL-sniff helper: determines affiliate source from URL domain patterns"
    - "shortUrl shadow variable: original URL preserved for Telegram button, shortUrl used only in caption"

key-files:
  created: []
  modified:
    - src/telegram/bot.ts
    - src/api/mercadoLivreAffiliate.ts
    - .env.example

key-decisions:
  - "Telegram inline button keeps original long affiliate URL — only caption uses shortUrl, ensuring direct-click still works"
  - "try/catch wraps every createLink call — DB outage never breaks message delivery"
  - "detectSource sniffs URL string (shopee, amazon/amzn, default ml) — no extra API call needed"
  - "buildMLSearchUrl references module-level PUBLISHER_ID / MATT_WORD constants directly — no new exports needed"

patterns-established:
  - "Short link injection pattern: declare shortUrl = original; try { link = await createLink(...); shortUrl = BASE_URL+/r/+link.code } catch { warn } — reusable across all send functions"

requirements-completed:
  - REQ-05
  - REQ-06

metrics:
  duration: "~30 min (multi-session including human checkpoint)"
  completed: "2026-06-11"
  tasks: 2
  files_created: 0
  files_modified: 3
---

# Phase 01 Plan 04: Telegram Bot Integration Summary

**Short link injection into all 4 Telegram send functions — captions carry BASE_URL/r/{code} URLs that produce WhatsApp OG preview cards with product image and title (verified in production).**

## Performance

- **Duration:** ~30 min (multi-session including human checkpoint)
- **Started:** 2026-06-11
- **Completed:** 2026-06-11
- **Tasks:** 2 auto + 1 human-verify checkpoint
- **Files modified:** 3

## Accomplishments

- All 4 send functions (`sendToTelegram`, `sendDealToChat`, `sendDealCard`, `sendProductToChat`) now generate a short link via `createLink()` before composing captions
- WhatsApp OG preview confirmed in production: pasting `https://ofertas.thaisbonomi.com.br/r/wyOcw` into WhatsApp rendered product image and title card
- `buildMLSearchUrl` exported from `mercadoLivreAffiliate.ts` for use in expired-redirect fallback logic
- `.env.example` documents all three new env vars (`DATABASE_URL`, `BASE_URL`, `AMAZON_TAG`)

## Task Commits

Each task was committed atomically:

1. **Task 1: Export buildMLSearchUrl and update .env.example** - `9e18a48` (feat)
2. **Task 2: Integrate createLink into all 4 bot send functions** - `94c13bf` (feat)

**Plan metadata:** (this summary commit)

## Files Created/Modified

- `src/telegram/bot.ts` — detectSource helper added; sendToTelegram, sendDealToChat, sendDealCard, sendProductToChat patched to generate short links with fallback
- `src/api/mercadoLivreAffiliate.ts` — `export function buildMLSearchUrl(title: string): string` appended
- `.env.example` — `# Link Shortener (Phase 1)` section added with DATABASE_URL, BASE_URL, AMAZON_TAG

## Decisions Made

- Telegram inline button (`Markup.button.url`) keeps the original long affiliate URL in `sendDealToChat` and `sendDealCard` — short URL is used only in the text caption where it needs to trigger WhatsApp preview; direct-click buttons work independently of the short link infrastructure
- Each send function has its own try/catch with `console.warn` — a DB failure on any single send does not prevent the Telegram message from being delivered
- `detectSource` uses simple URL string matching (`url.includes('shopee')`, `url.includes('amazon') || url.includes('amzn')`, default `'ml'`) — no external call, no performance hit

## Deviations from Plan

None — plan executed exactly as written. Both task commits matched the acceptance criteria in the PLAN.md.

## Human Verification: PASSED

**Checkpoint:** WhatsApp OG preview test
**Result:** APPROVED — WhatsApp preview shows product image and title when the short URL (`https://ofertas.thaisbonomi.com.br/r/wyOcw`) is pasted into a WhatsApp chat. Full link shortener stack confirmed working end-to-end in production.

## Issues Encountered

None.

## User Setup Required

Railway Postgres must be provisioned and environment variables set for the link shortener to function in production:

- `DATABASE_URL` — Railway Dashboard → New Service → Database → PostgreSQL → Connect → copy DATABASE_URL; set as reference variable on Express service
- `BASE_URL` — set to `https://ofertas.thaisbonomi.com.br` on Railway Express service
- `AMAZON_TAG` — Amazon Associates tag ID (e.g. `seutag-20`)

See `.env.example` for full documentation.

## Next Phase Readiness

- Full link shortener stack is complete and verified in production
- Short links are injected into all Telegram captions — every product/deal message now carries a WhatsApp-previewable URL
- No blockers for next phase

---
*Phase: 01-link-curto-whatsapp*
*Completed: 2026-06-11*

## Self-Check: PASSED

- `src/telegram/bot.ts` modified: FOUND (commit 94c13bf)
- `src/api/mercadoLivreAffiliate.ts` modified: FOUND (commit 9e18a48)
- `.env.example` modified: FOUND (commit 9e18a48)
- Commit `9e18a48` (Task 1): FOUND
- Commit `94c13bf` (Task 2): FOUND
- Human checkpoint: APPROVED — WhatsApp preview confirmed in production
