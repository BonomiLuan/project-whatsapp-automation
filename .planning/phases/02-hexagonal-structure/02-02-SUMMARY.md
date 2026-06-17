---
phase: 02-hexagonal-structure
plan: 02
subsystem: adapters
tags: [typescript, hexagonal-architecture, refactor, file-move, affiliates, db]

# Dependency graph
requires:
  - "02-01 (directory scaffold) — src/adapters/affiliates/ and src/adapters/db/ directories"
provides:
  - "src/adapters/affiliates/AmazonAffiliate.ts — Amazon affiliate link builder"
  - "src/adapters/affiliates/MLAffiliate.ts — Mercado Livre affiliate adapter"
  - "src/adapters/affiliates/ShopeeAffiliate.ts — Shopee affiliate adapter"
  - "src/adapters/db/HistoryRepository.ts — Deal send history persistence"
affects:
  - "02-03 (PelandoScraper) — pelando.ts importers updated"
  - "02-06 (composition root) — all affiliate adapters at new paths"

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Affiliate adapters live in src/adapters/affiliates/ (hexagonal outer ring)"
    - "DB adapters live in src/adapters/db/ (hexagonal outer ring)"
    - "Pure file moves: zero behavior changes, identical file content"

key-files:
  created:
    - src/adapters/affiliates/AmazonAffiliate.ts
    - src/adapters/affiliates/MLAffiliate.ts
    - src/adapters/affiliates/ShopeeAffiliate.ts
    - src/adapters/db/HistoryRepository.ts
  modified:
    - src/content/pelando.ts
    - src/content/mercadoLivre.ts
    - src/telegram/bot.ts
    - src/server/index.ts
  deleted:
    - src/api/amazonAffiliate.ts
    - src/api/mercadoLivreAffiliate.ts
    - src/api/shopeeAffiliate.ts
    - src/server/history.ts

key-decisions:
  - "src/api/ still contains metaClient.ts (out of scope for this plan — moved in a later plan)"
  - "HistoryRepository __dirname path fixed: ../../data → ../../../data (depth change from src/server/ to src/adapters/db/)"
  - "src/server/index.ts also imported mercadoLivreAffiliate — updated in B2 commit alongside the file move"

patterns-established:
  - "Each file move is one atomic commit: new file + all importers updated + old file deleted"
  - "tsc --noEmit gate enforced after every atomic commit"

requirements-completed:
  - STRUCT-06
  - STRUCT-10

# Metrics
duration: 15min
completed: 2026-06-17
---

# Phase 02 Plan 02: Move Affiliate Adapters and HistoryRepository Summary

**3 affiliate adapters (Amazon, ML, Shopee) and history persistence moved from src/api/ and src/server/ to their hexagonal adapter paths in 4 atomic commits, each passing tsc --noEmit; all 16 tests green**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-06-17T13:30:00Z
- **Completed:** 2026-06-17T13:45:00Z
- **Tasks:** 3 (4 sub-commits: B1, B2, B3, B4)
- **Files created:** 4
- **Files modified:** 4
- **Files deleted:** 4

## Accomplishments

- Moved `src/api/amazonAffiliate.ts` → `src/adapters/affiliates/AmazonAffiliate.ts` (B1)
- Moved `src/api/mercadoLivreAffiliate.ts` → `src/adapters/affiliates/MLAffiliate.ts` (B2)
- Moved `src/api/shopeeAffiliate.ts` → `src/adapters/affiliates/ShopeeAffiliate.ts` (B3)
- Moved `src/server/history.ts` → `src/adapters/db/HistoryRepository.ts` (B4)
- Updated all importers in pelando.ts, mercadoLivre.ts, bot.ts, and server/index.ts
- tsc --noEmit passed after every commit; npm test: 16 tests pass

## Task Commits

1. **Task 1: Move AmazonAffiliate** - `671529b` (refactor)
2. **Task 2a: Move MLAffiliate** - `3e70ecb` (refactor)
3. **Task 2b: Move ShopeeAffiliate** - `c7d4f3f` (refactor)
4. **Task 3: Move HistoryRepository** - `53692bc` (refactor)

## Files Created/Modified

- `src/adapters/affiliates/AmazonAffiliate.ts` — Amazon affiliate link builder (moved)
- `src/adapters/affiliates/MLAffiliate.ts` — Mercado Livre affiliate adapter (moved)
- `src/adapters/affiliates/ShopeeAffiliate.ts` — Shopee affiliate adapter (moved)
- `src/adapters/db/HistoryRepository.ts` — Deal send history persistence (moved)
- `src/content/pelando.ts` — imports updated (Amazon, ML, Shopee)
- `src/content/mercadoLivre.ts` — imports updated (ML, Shopee)
- `src/telegram/bot.ts` — imports updated (Amazon, ML, Shopee)
- `src/server/index.ts` — imports updated (Shopee, ML, HistoryRepository)

## Decisions Made

- `src/api/metaClient.ts` remains in place — it is NOT an affiliate adapter and not in scope for this plan
- `HistoryRepository.ts` path corrected: moved from `src/server/` (depth 2) to `src/adapters/db/` (depth 3), so `__dirname`-relative path to `data/` changed from `../../data/` to `../../../data/`

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] src/server/index.ts also imported mercadoLivreAffiliate**
- **Found during:** Task 2 B2 (tsc --noEmit failed)
- **Issue:** The plan's importer list for MLAffiliate did not include index.ts, but index.ts had `import { fetchMLProductInfo, injectMLTag } from '../api/mercadoLivreAffiliate.js'`
- **Fix:** Updated import in index.ts to `'../adapters/affiliates/MLAffiliate.js'` as part of B2 commit
- **Files modified:** src/server/index.ts
- **Commit:** 3e70ecb

**2. [Rule 1 - Bug] HistoryRepository __dirname path depth mismatch**
- **Found during:** Task 3 code review (not a tsc error — a runtime path issue)
- **Issue:** Original history.ts used `../../data/history.json` from `src/server/`. New location is `src/adapters/db/`, one level deeper, so correct path is `../../../data/history.json`
- **Fix:** Updated path in HistoryRepository.ts before committing
- **Files modified:** src/adapters/db/HistoryRepository.ts
- **Commit:** 53692bc

## Issues Encountered

- `src/api/` still contains `metaClient.ts` — this file is imported by `src/telegram/bot.ts` and `src/server/index.ts` and was not listed as part of this plan's scope. Directory cannot be fully deleted until `metaClient.ts` is moved (presumably in a future plan).

## Known Stubs

None — all moves are complete implementations. No placeholder behavior.

## Threat Flags

None — pure file moves; no new I/O, no new entry points, no new trust boundaries.

## Self-Check: PASSED

- `src/adapters/affiliates/AmazonAffiliate.ts` — FOUND
- `src/adapters/affiliates/MLAffiliate.ts` — FOUND
- `src/adapters/affiliates/ShopeeAffiliate.ts` — FOUND
- `src/adapters/db/HistoryRepository.ts` — FOUND
- `src/api/amazonAffiliate.ts` — CORRECTLY ABSENT
- `src/api/mercadoLivreAffiliate.ts` — CORRECTLY ABSENT
- `src/api/shopeeAffiliate.ts` — CORRECTLY ABSENT
- `src/server/history.ts` — CORRECTLY ABSENT
- Commits 671529b, 3e70ecb, c7d4f3f, 53692bc — FOUND in git log
- tsc --noEmit: PASS
- npm test: 16 passed, 14 skipped (live DB), 0 failed

## Next Phase Readiness

- All 3 affiliate adapters at hexagonal paths; remaining plans (02-03 to 02-06) can reference them
- `src/adapters/db/HistoryRepository.ts` ready for use by composition root (plan 02-06)
- `src/api/` still has `metaClient.ts` — needs moving before `src/api/` can be removed

---
*Phase: 02-hexagonal-structure*
*Completed: 2026-06-17*
