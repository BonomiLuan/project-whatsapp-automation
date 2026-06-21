---
phase: 03-core-domain-extraction
plan: "01"
subsystem: core-usecases
tags: [pure-functions, characterization-tests, filterDeals, categoryRotation, formatMessage, tdd]
dependency_graph:
  requires: []
  provides:
    - src/core/usecases/FilterDeals.ts
    - src/core/usecases/CategoryRotation.ts
    - src/core/usecases/helpers/formatMessage.ts
  affects:
    - Wave 2/3 god-file splits (unblocked by this safety net)
tech_stack:
  added: []
  patterns:
    - Pure function extraction with zero IO imports
    - Characterization / golden-master testing with Vitest
key_files:
  created:
    - src/core/usecases/FilterDeals.ts
    - src/core/usecases/CategoryRotation.ts
    - src/core/usecases/helpers/formatMessage.ts
    - tests/usecases/FilterDeals.test.ts
    - tests/usecases/CategoryRotation.test.ts
    - tests/usecases/formatMessage.test.ts
  modified: []
decisions:
  - "filterDeals uses case-insensitive substring matching for excludeKeywords (lowercased includes), consistent with the prime/app-only regex intent in PelandoScraper"
  - "preferDifferentSource falls back to all candidates when all share the same source, preventing empty results"
  - "formatMessage is byte-identical to TelegramPublisher.ts inline implementation (same array + filter + join logic)"
metrics:
  duration: ~15m
  completed: "2026-06-20T10:25:35Z"
  tasks_completed: 3
  tasks_total: 3
  files_created: 6
  files_modified: 0
---

# Phase 03 Plan 01: Extract Core Pure Functions — Summary

**One-liner:** Extracted filterDeals, nextCategory/preferDifferentSource, and formatMessage as zero-IO pure functions in `src/core/usecases/`, each protected by Vitest characterization tests (27 tests total, all passing).

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Extract filterDeals as pure characterized function | 159b299 | src/core/usecases/FilterDeals.ts, tests/usecases/FilterDeals.test.ts |
| 2 | Extract CategoryRotation (nextCategory + preferDifferentSource) | a0b4530 | src/core/usecases/CategoryRotation.ts, tests/usecases/CategoryRotation.test.ts |
| 3 | Extract formatMessage Telegram caption builder | 943b3de | src/core/usecases/helpers/formatMessage.ts, tests/usecases/formatMessage.test.ts |

## Verification Results

- `npx vitest run tests/usecases/` — 27 tests across 3 suites, all passing
- `npx tsc --noEmit` — exits 0
- No `src/core/` file imports from `adapters/`, `web/`, or `jobs/` — confirmed 0 violations
- No god-file modified — `git diff` touches only the 6 declared files

## Deviations from Plan

None — plan executed exactly as written. All three pure functions match the behavior described in `<behavior>` bullets. formatMessage is byte-identical to the inline implementation in TelegramPublisher.ts lines 32-63.

## Known Stubs

None — all pure functions are fully implemented and wired to their test suites. No placeholder data.

## Threat Flags

None — this plan adds no new network, DB, or process-install surface. The T-03-01 mitigation (read-only lowercased substring compare, no eval, no regex from untrusted input) is implemented as specified.

## Self-Check: PASSED

- [x] src/core/usecases/FilterDeals.ts — FOUND
- [x] src/core/usecases/CategoryRotation.ts — FOUND
- [x] src/core/usecases/helpers/formatMessage.ts — FOUND
- [x] tests/usecases/FilterDeals.test.ts — FOUND
- [x] tests/usecases/CategoryRotation.test.ts — FOUND
- [x] tests/usecases/formatMessage.test.ts — FOUND
- [x] Commit 159b299 — feat(03-01): extract filterDeals
- [x] Commit a0b4530 — feat(03-01): extract CategoryRotation
- [x] Commit 943b3de — feat(03-01): extract formatMessage
