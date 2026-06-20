---
phase: 03-core-domain-extraction
plan: "03"
subsystem: core-usecases
tags: [use-cases, tdd, MonitorDeals, SuggestDeals, port-injection, fake-ports]
dependency_graph:
  requires:
    - src/core/usecases/FilterDeals.ts (03-01)
    - src/core/usecases/CategoryRotation.ts (03-01)
    - src/core/ports/DealScraper.ts
    - src/core/ports/DealPublisher.ts
    - src/core/ports/DealRepository.ts
    - src/core/ports/TenantRepository.ts
    - src/core/ports/RotationStore.ts
  provides:
    - src/core/usecases/MonitorDeals.ts
    - src/core/usecases/SuggestDeals.ts
    - tests/usecases/MonitorDeals.test.ts
    - tests/usecases/SuggestDeals.test.ts
  affects:
    - Wave 3 composition root (wires use cases into cron jobs and handlers)
tech_stack:
  added: []
  patterns:
    - Constructor injection with import type — zero runtime coupling to adapters
    - TDD RED/GREEN per use case (failing test commit then implementation commit)
    - Fake ports as object literals in test files — no mock libraries
    - At-least-once publish ordering (publish → markAsSent)
    - Cursor-on-success invariant (RotationStore.save only after successful publish)
key_files:
  created:
    - src/core/usecases/MonitorDeals.ts
    - src/core/usecases/SuggestDeals.ts
    - tests/usecases/MonitorDeals.test.ts
    - tests/usecases/SuggestDeals.test.ts
  modified: []
decisions:
  - "SuggestDeals derives allCategories from the available pool (unique insertion-ordered Set) rather than a hard-coded global list — decouples the use case from CATEGORY_META in server.ts"
  - "SuggestDeals throws publish errors upward (no try/catch in use case) — cursor-on-success invariant requires the caller to observe the failure; timing-lock concerns belong in the job layer"
  - "Test for source variety uses 10 independent SuggestDeals instances each with fresh store starting at lastSource='amazon' — avoids cross-run cursor contamination from evolving state"
  - "MonitorDeals category parameter forwarded to scraper.fetchDeals(category?) — enables targeted scraping without changing the core contract"
metrics:
  duration: ~20min
  completed: "2026-06-20"
  tasks_completed: 2
  tasks_total: 2
  files_created: 4
  files_modified: 0
---

# Phase 03 Plan 03: Extract MonitorDeals and SuggestDeals Use Cases — Summary

**One-liner:** MonitorDeals and SuggestDeals extracted as port-only use cases with 12 fake-port unit tests covering publish ordering, dedupe, failure isolation, category rotation, and source variety.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 RED | MonitorDeals failing tests | f8349f6 | tests/usecases/MonitorDeals.test.ts |
| 1 GREEN | MonitorDeals implementation | 49d849d | src/core/usecases/MonitorDeals.ts |
| 2 RED | SuggestDeals failing tests | 244c28e | tests/usecases/SuggestDeals.test.ts |
| 2 GREEN | SuggestDeals implementation | 7df1d03 | src/core/usecases/SuggestDeals.ts |

## Verification Results

- `npx vitest run tests/usecases/MonitorDeals.test.ts tests/usecases/SuggestDeals.test.ts` — 12/12 tests passing
- `npx tsc --noEmit` — exits 0
- Core purity: `grep -rE "from '\.\./(adapters|web|jobs)'" src/core/usecases/` — 0 violations
- grep gate for SuggestDeals: 0 adapter/pg/claimAutoSendSlot imports
- No god-file modified (server.ts, index.ts untouched)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Test for source variety re-used mutable state across 10 runs**
- **Found during:** Task 2 GREEN phase (test failed after implementation was correct)
- **Issue:** The original test shared one `rotationStore` across 10 `execute()` calls. After run 1 the cursor's `lastSource` updated to 'pelando', causing run 2 to prefer 'amazon' instead — making the 10-run assertion fail non-deterministically.
- **Fix:** Each of the 10 runs creates a fresh `SuggestDeals` instance with a new `makeFakeRotationStore({ roundRobinIndex: 0, lastSource: 'amazon' })` so the initial condition is identical for every run.
- **Files modified:** tests/usecases/SuggestDeals.test.ts
- **Commit:** 7df1d03 (included in GREEN commit)

## Known Stubs

None — both use cases are fully implemented and wired to their test suites. No placeholder or hardcoded data.

## Threat Flags

None — this plan adds no new network endpoints, auth paths, file access patterns, or schema changes. All IO flows through injected ports. T-03-07 (per-deal isolation) and T-03-08 (purity gate) are verified by tests and grep.

## TDD Gate Compliance

- Task 1: test commit f8349f6 (RED) → feat commit 49d849d (GREEN) — gate satisfied
- Task 2: test commit 244c28e (RED) → feat commit 7df1d03 (GREEN) — gate satisfied

## Self-Check: PASSED

- [x] src/core/usecases/MonitorDeals.ts — FOUND, contains `export class MonitorDeals`
- [x] src/core/usecases/SuggestDeals.ts — FOUND, contains `export class SuggestDeals`
- [x] tests/usecases/MonitorDeals.test.ts — FOUND (6 tests)
- [x] tests/usecases/SuggestDeals.test.ts — FOUND (6 tests)
- [x] Commit f8349f6 — test(03-03): add failing tests for MonitorDeals use case
- [x] Commit 49d849d — feat(03-03): implement MonitorDeals port-only use case
- [x] Commit 244c28e — test(03-03): add failing tests for SuggestDeals use case
- [x] Commit 7df1d03 — feat(03-03): implement SuggestDeals port-only use case
