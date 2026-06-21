---
phase: 03-core-domain-extraction
plan: "04"
subsystem: adapters
tags: [hexagonal, ports-and-adapters, DealPublisher, DealScraper, toDeal, characterization-tests]
dependency_graph:
  requires:
    - src/core/ports/DealPublisher.ts
    - src/core/ports/DealScraper.ts
    - src/core/domain/Deal.ts
    - src/core/domain/Tenant.ts
    - src/core/usecases/helpers/formatMessage.ts
  provides:
    - src/adapters/publishers/TelegramPublisher.ts (TelegramPublisher implements DealPublisher)
    - src/adapters/scrapers/PelandoScraper.ts (PelandoScraper implements DealScraper)
    - src/adapters/scrapers/MercadoLivreScraper.ts (MercadoLivreScraper implements DealScraper)
    - tests/adapters/toDeal.test.ts
  affects:
    - Wave 3 rewiring (god-file split / composition root)
tech_stack:
  added: []
  patterns:
    - Hexagonal adapter implements port interface
    - Exported pure toDeal helper for IO-free unit testing
    - Brazilian price string parsing (dot-thousands / comma-decimal)
    - Characterization tests over hand-built raw fixtures
key_files:
  created:
    - tests/adapters/toDeal.test.ts
  modified:
    - src/adapters/publishers/TelegramPublisher.ts
    - src/adapters/scrapers/PelandoScraper.ts
    - src/adapters/scrapers/MercadoLivreScraper.ts
decisions:
  - "Exported toDealPelando/toDealML as pure top-level functions (not private class methods) so tests are IO-free without mocking the class or the network"
  - "parseBRPrice() strips dot thousands separator before parsing; handles 'R$1.299,90' → 1299.90 correctly (auto-fixed Rule 1 bug found during test run)"
  - "TelegramPublisher.toDeal is private (maps UnifiedDeal→Deal for publish() path); scrapers export toDeal publicly for test access — asymmetric by design"
  - "PelandoScraper.fetchDeals ignores the category parameter (existing fetchDeals scrapes fixed category URLs); consistent with plan spec"
metrics:
  duration: ~25m
  completed: "2026-06-20T07:35:00Z"
  tasks_completed: 2
  tasks_total: 2
  files_created: 1
  files_modified: 3
---

# Phase 03 Plan 04: Adapter Port Conformance (DealPublisher + DealScraper) — Summary

**One-liner:** TelegramPublisher implements DealPublisher (replacing the inline formatMessage duplicate with the pure helper), and PelandoScraper/MercadoLivreScraper implement DealScraper via tested toDeal pure functions — all raw types kept internal, zero behavior change.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | TelegramPublisher implements DealPublisher + toDeal + pure formatMessage | aae8e3d | src/adapters/publishers/TelegramPublisher.ts |
| 2 | PelandoScraper + MercadoLivreScraper implement DealScraper with toDeal | 49dc437 | src/adapters/scrapers/PelandoScraper.ts, src/adapters/scrapers/MercadoLivreScraper.ts, tests/adapters/toDeal.test.ts |

## Verification Results

- `npx vitest run tests/adapters/toDeal.test.ts tests/usecases/formatMessage.test.ts` — 29 tests, all passing
- `npx tsc --noEmit` — exits 0
- Core purity: `grep -rE "UnifiedDeal|PelandoDeal" src/core/ | wc -l` returns 0
- Inline formatMessage removed: `grep -c "^function formatMessage" src/adapters/publishers/TelegramPublisher.ts` returns 0
- All legacy exports preserved: createBot, sendDealToChat, sendProductToChat, sendPelandoCouponToChat, fetchDeals, fetchMLCategoryDeals

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Brazilian price string parsing (R$1.299,90)**
- **Found during:** Task 2, test execution
- **Issue:** `R$1.299,90` parsed as 1.299 instead of 1299.90 because the dot (thousands separator) was treated as a decimal point
- **Fix:** Introduced `parseBRPrice()` in both scrapers and TelegramPublisher that strips dots (thousands separator) before converting comma to decimal dot
- **Files modified:** src/adapters/scrapers/MercadoLivreScraper.ts, src/adapters/scrapers/PelandoScraper.ts, src/adapters/publishers/TelegramPublisher.ts
- **Commit:** 49dc437 (fix included in Task 2 commit)

## Known Stubs

None — all port implementations delegate to the existing scraping/publishing pipelines. No placeholder data.

## Threat Flags

None — no new network endpoints, auth paths, or file access patterns introduced. All new surface is pure in-memory type conversion.

- T-03-09 (price parsing tampering): mitigated by `parseBRPrice()` with `|| 0` fallback — NaN never flows downstream
- T-03-10 (UnifiedDeal/PelandoDeal leak): confirmed 0 occurrences in src/core/ post-implementation
- T-03-11 (formatMessage swap): mitigated — 10 golden-master tests still passing after removing inline duplicate

## Self-Check: PASSED

- [x] src/adapters/publishers/TelegramPublisher.ts — FOUND, contains `class TelegramPublisher implements DealPublisher`
- [x] src/adapters/scrapers/PelandoScraper.ts — FOUND, contains `class PelandoScraper implements DealScraper`
- [x] src/adapters/scrapers/MercadoLivreScraper.ts — FOUND, contains `class MercadoLivreScraper implements DealScraper`
- [x] tests/adapters/toDeal.test.ts — FOUND, 19 passing tests
- [x] Commit aae8e3d — refactor(03-04): TelegramPublisher implements DealPublisher
- [x] Commit 49dc437 — feat(03-04): PelandoScraper + MercadoLivreScraper implement DealScraper
