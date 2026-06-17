---
phase: 02-hexagonal-structure
plan: "03"
subsystem: adapters
tags: [refactor, hexagonal, adapters, publishers, scrapers, file-move]
dependency_graph:
  requires: [02-02]
  provides: [adapters/publishers/format, adapters/publishers/WhatsAppPublisher, adapters/scrapers/ProductScraper]
  affects: [src/server/index.ts, src/telegram/bot.ts, src/scraper/test.ts]
tech_stack:
  added: []
  patterns: [hexagonal-architecture, adapter-layer, file-move]
key_files:
  created:
    - src/adapters/publishers/format.ts
    - src/adapters/publishers/WhatsAppPublisher.ts
    - src/adapters/scrapers/ProductScraper.ts
  modified:
    - src/server/index.ts
    - src/telegram/bot.ts
    - src/scraper/test.ts
decisions:
  - "format.ts import of ProductData updated from ../../scraper/productScraper.js to ../scrapers/ProductScraper.js in same wave (not deferred)"
  - "src/scraper/test.ts left in original directory with import updated to point to new adapter path"
metrics:
  duration: "~8 minutes"
  completed: "2026-06-17"
---

# Phase 02 Plan 03: Adapter File Moves (Wave 3) Summary

Move 3 legacy files to hexagonal adapter locations: messageBuilder→format, metaClient→WhatsAppPublisher, productScraper→ProductScraper — each as an atomic commit with tsc passing.

## Tasks Completed

| Task | Description | Commit | Files |
|------|-------------|--------|-------|
| 1 (C1) | Move content/messageBuilder.ts → adapters/publishers/format.ts | 9bb7283 | format.ts created; server/index.ts, telegram/bot.ts, api/metaClient.ts updated; messageBuilder.ts deleted |
| 2 (C2) | Move api/metaClient.ts → adapters/publishers/WhatsAppPublisher.ts | df2c108 | WhatsAppPublisher.ts created; server/index.ts, telegram/bot.ts updated; metaClient.ts deleted |
| 3 (C3) | Move scraper/productScraper.ts → adapters/scrapers/ProductScraper.ts | da63ad2 | ProductScraper.ts created; server/index.ts (2 imports), telegram/bot.ts, format.ts, scraper/test.ts updated; productScraper.ts deleted |

## Verification

- tsc --noEmit: passes after each commit
- npm test: 16 pass, 14 todo (DB-only tests skipped — expected)
- src/adapters/publishers/ has format.ts and WhatsAppPublisher.ts
- src/adapters/scrapers/ has ProductScraper.ts
- src/content/messageBuilder.ts: deleted
- src/api/metaClient.ts: deleted
- src/scraper/productScraper.ts: deleted

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] format.ts internal import path updated in Task 3**
- **Found during:** Task 3
- **Issue:** format.ts was created in Task 1 with `../../scraper/productScraper.js` pointing to the old location of productScraper. When productScraper moved in Task 3, this path became stale.
- **Fix:** Updated format.ts import to `../scrapers/ProductScraper.js` in the same Task 3 commit.
- **Files modified:** src/adapters/publishers/format.ts
- **Commit:** da63ad2

**2. [Rule 1 - Bug] src/scraper/test.ts import updated**
- **Found during:** Task 3
- **Issue:** test.ts imported `./productScraper.js` which was deleted. tsc would fail if left as-is.
- **Fix:** Updated import in test.ts to `../adapters/scrapers/ProductScraper.js`. File left in original directory as allowed by the plan.
- **Files modified:** src/scraper/test.ts
- **Commit:** da63ad2

## Known Stubs

None — pure file moves; no new UI or data rendering surface.

## Threat Flags

None — pure refactor with no new I/O, network endpoints, or trust boundaries.

## Self-Check: PASSED

- src/adapters/publishers/format.ts: EXISTS
- src/adapters/publishers/WhatsAppPublisher.ts: EXISTS
- src/adapters/scrapers/ProductScraper.ts: EXISTS
- src/content/messageBuilder.ts: DELETED
- src/api/metaClient.ts: DELETED
- src/scraper/productScraper.ts: DELETED
- Commits 9bb7283, df2c108, da63ad2: VERIFIED in git log
