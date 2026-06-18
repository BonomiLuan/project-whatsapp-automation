---
phase: 02-hexagonal-structure
plan: "05"
subsystem: adapters
tags: [refactor, hexagonal, adapters, db, lock, file-split]
dependency_graph:
  requires: [02-04]
  provides: [adapters/db/pool, adapters/db/PgLinkRepository, adapters/lock/PgAdvisoryLock, adapters/db/PgDealRepository, adapters/db/PgTenantRepository]
  affects: [src/server/index.ts, src/telegram/bot.ts, tests/links.test.ts]
tech_stack:
  added: []
  patterns: [hexagonal-architecture, adapter-layer, singleton-pool, file-split]
key_files:
  created:
    - src/adapters/db/pool.ts
    - src/adapters/db/PgLinkRepository.ts
    - src/adapters/lock/PgAdvisoryLock.ts
    - src/adapters/db/PgDealRepository.ts
    - src/adapters/db/PgTenantRepository.ts
  modified:
    - src/server/index.ts
    - src/telegram/bot.ts
    - tests/links.test.ts
  deleted:
    - src/server/links.ts
decisions:
  - "pool.ts created as singleton to prevent double-Pool bug (T-02-05 mitigation)"
  - "withCronLock and claimAutoSendSlot moved to adapters/lock/PgAdvisoryLock — separate lock concern from persistence"
  - "PgDealRepository and PgTenantRepository are Phase-3 stubs (throw Not implemented)"
metrics:
  duration: "~12 minutes"
  completed: "2026-06-18"
---

# Phase 02 Plan 05: links.ts Split — db/PgLinkRepository + lock/PgAdvisoryLock + db/pool (Wave 5) Summary

Split src/server/links.ts into 3 adapter files (pool.ts singleton, PgLinkRepository.ts para todo CRUD de links, PgAdvisoryLock.ts para funções de lock distribuído) mais 2 stubs Phase-3 (PgDealRepository, PgTenantRepository), atualizando todos os 3 callers atomicamente.

## Tasks Completed

| Task | Description | Commit | Files |
|------|-------------|--------|-------|
| 1 (E1) | Split server/links.ts → db/pool + db/PgLinkRepository + lock/PgAdvisoryLock; update all callers | 4f15225 | pool.ts, PgLinkRepository.ts, PgAdvisoryLock.ts created; server/index.ts, telegram/bot.ts, tests/links.test.ts updated; links.ts deleted |
| 2 (E2) | Create PgDealRepository and PgTenantRepository stubs (STRUCT-07) | 6f4f8e9 | PgDealRepository.ts, PgTenantRepository.ts created |

## Verification

- tsc --noEmit: passes after each commit
- npm test: 16 pass, 14 todo (DB-only tests skipped — expected)
- `new Pool(` appears only in src/adapters/db/pool.ts (T-02-05 mitigated)
- src/server/links.ts: deleted
- grep "server/links" tests/links.test.ts: 0 matches (T-02-06 mitigated)
- grep "adapters/db/PgLinkRepository" tests/links.test.ts: 1 match
- grep "adapters/db/PgLinkRepository" src/server/index.ts: 1 match
- grep "adapters/lock/PgAdvisoryLock" src/server/index.ts: 1 match
- grep "adapters/db/PgLinkRepository" src/telegram/bot.ts: 1 match

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

| Stub | File | Reason |
|------|------|--------|
| PgDealRepository (all methods) | src/adapters/db/PgDealRepository.ts | Phase-3 placeholder — deal history migration deferred |
| PgTenantRepository (all methods) | src/adapters/db/PgTenantRepository.ts | Phase-3 placeholder — multi-tenant migration deferred |

Both stubs are intentional per plan spec (STRUCT-07 satisfied by file existence + correct port shape). Phase 3 will provide full implementations.

## Threat Flags

None — refactor only; no new network endpoints, auth paths, or trust boundaries introduced. T-02-05 (double-Pool) and T-02-06 (test import path) both mitigated.

## Self-Check: PASSED

- src/adapters/db/pool.ts: EXISTS
- src/adapters/db/PgLinkRepository.ts: EXISTS
- src/adapters/lock/PgAdvisoryLock.ts: EXISTS
- src/adapters/db/PgDealRepository.ts: EXISTS
- src/adapters/db/PgTenantRepository.ts: EXISTS
- src/server/links.ts: DELETED
- Commits 4f15225, 6f4f8e9: VERIFIED in git log
