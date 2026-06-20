---
phase: 03-core-domain-extraction
plan: "05"
subsystem: composition-root
tags: [hexagonal, composition-root, DI, jobs, wiring, server-reduction]
dependency_graph:
  requires:
    - src/adapters/lock/PgAdvisoryLock.ts
    - src/adapters/store/InMemoryRotationStore.ts
    - src/adapters/db/PgDealRepository.ts
    - src/adapters/db/PgTenantRepository.ts
    - src/adapters/publishers/TelegramPublisher.ts
    - src/adapters/scrapers/PelandoScraper.ts
    - src/adapters/scrapers/MercadoLivreScraper.ts
    - src/adapters/scheduler/NodeCronScheduler.ts
    - src/core/usecases/MonitorDeals.ts
    - src/core/usecases/SuggestDeals.ts
  provides:
    - src/index.ts (composition root — DI wiring entry point)
    - src/jobs/monitorPelando.ts (export registerPelandoMonitor)
    - src/jobs/monitorML.ts (export registerMLMonitor)
    - src/jobs/cronLock.ts (export registerSuggestionJobs)
    - tests/wiring/composition.test.ts
  affects:
    - src/web/server.ts (reduced — removed suggestion rotation god-code)
tech_stack:
  added: []
  patterns:
    - Composition root — single entry point constructs and wires all objects
    - DI register functions — jobs export register* instead of firing at import
    - Port-only use cases driven by adapter instantiation in index.ts
    - Scheduler port abstracts node-cron (no test coupling to real timers)
key_files:
  created:
    - tests/wiring/composition.test.ts
  modified:
    - src/index.ts
    - src/jobs/monitorPelando.ts
    - src/jobs/monitorML.ts
    - src/jobs/cronLock.ts
    - src/web/server.ts
decisions:
  - Used FakeScheduler (records job names/cron expressions) for wiring tests — avoids live timer coupling
  - registerSuggestionJobs takes TenantRepository explicitly so midnight reset can iterate all tenant cursors
  - server.ts retains monitorPelando/monitorML exports because TelegramPublisher /atualizar command uses dynamic import
  - sentTodayLog kept in server.ts (feeds /api/sent-today HTTP route); sentToday Set removed (was only for suggestion dedup)
metrics:
  duration_minutes: 35
  tasks_completed: 2
  tasks_total: 2
  files_created: 2
  files_modified: 5
  tests_added: 4
  tests_passing: 87
  completed_date: "2026-06-20"
---

# Phase 03 Plan 05: Composition Root Wiring + Server Reduction Summary

DI register functions for all 3 job files + index.ts rewritten as composition root + server.ts stripped of god-code rotation state. 4 wiring tests pass, 87 total tests pass.

## Tasks Completed

### Task 1 — Jobs become DI register functions

| File | Before | After |
|------|--------|-------|
| `src/jobs/monitorPelando.ts` | `cron.schedule(...)` at import | `export function registerPelandoMonitor(scheduler, lock, monitor)` |
| `src/jobs/monitorML.ts` | `cron.schedule(...)` at import | `export function registerMLMonitor(scheduler, lock, monitor)` |
| `src/jobs/cronLock.ts` | `cron.schedule(...)` at import | `export function registerSuggestionJobs(scheduler, suggest, rotationStore, tenantRepo)` |

Commit: `4b11c0a` — `refactor(03-05): jobs become DI register functions`

### Task 2 — Composition root + server.ts reduction

**`src/index.ts`** rewritten: instantiates `PgAdvisoryLock`, `InMemoryRotationStore`, `PgDealRepository`, `PgTenantRepository`, `TelegramPublisher`, `PelandoScraper`, `MercadoLivreScraper`, `NodeCronScheduler`; constructs `MonitorDeals` (x2) and `SuggestDeals`; calls all three register* functions; imports `server.js`.

**`src/web/server.ts`** reduced:
- REMOVED: `roundRobinIndex`, `lastSentSource` module vars
- REMOVED: `ALL_CATEGORIES` const
- REMOVED: `sendNextSuggestion()` export (SuggestDeals use case owns this now)
- REMOVED: `resetDailyState()` export (InMemoryRotationStore.reset() owns this now)
- REMOVED: `monitorPelando()` call in `app.listen` (composition root drives it)
- REMOVED: `claimAutoSendSlot`, `getExcludedDealIds`, `recordDealSent` imports (unused)
- KEPT: `refreshDeals()`, `getCachedDeals()`, `getSentToday()`, `sentTodayLog`, routes, bot, listen

**`tests/wiring/composition.test.ts`** — 4 tests with `FakeScheduler` verifying all job registrations:
- `registerPelandoMonitor` -> name=`pelando-monitor`, cron=`*/30 * * * *`
- `registerMLMonitor` -> name=`ml-monitor`, cron=`*/30 * * * *`
- `registerSuggestionJobs` -> names=`suggest-deals` + `reset-rotation`, correct expressions
- All 4 together -> exactly 4 jobs in declared order

Commit: `82a2592` — `feat(03-05): composition root wiring + server.ts reduction`

## Deviations from Plan

### Auto-adapted: SuggestDeals constructor

**Found during:** Task 2

**Issue:** Plan said `new SuggestDeals(rotationStore, dealRepo, publisher, tenantRepo)` (4 args) but the actual constructor from Plan 03-03 is `new SuggestDeals(rotationStore, dealRepo, publisher)` (3 args — no tenantRepo). `execute(tenant, pool)` takes tenant + pool at call time.

**Fix:** `registerSuggestionJobs` accepts `tenantRepo` separately and fetches tenants at job-fire time; `new SuggestDeals(rotationStore, dealRepo, telegramPublisher)` uses the correct 3-arg constructor.

**Impact:** `registerSuggestionJobs` signature has 4 params instead of the plan's 3 — test updated accordingly.

### Auto-adapted: cronLock.ts imports getCachedDeals from server.ts

**Found during:** Task 1

**Issue:** The suggestion job needs a deal pool. `SuggestDeals.execute(tenant, pool)` requires the deals to be passed in. `getCachedDeals()` from server.ts provides the in-memory pool.

**Fix:** `cronLock.ts` imports `getCachedDeals` from `../web/server.js` and maps `UnifiedDeal` to core `Deal` at call time. This keeps the use case pure (no server.ts knowledge) while providing the pool from the existing cache.

## Verification

```
npx tsc --noEmit           # exit 0 — clean
npx vitest run             # 87 passed | 14 todo (DB-dependent, expected)
grep -c "roundRobinIndex|lastSentSource" src/web/server.ts   # 0
grep -c "ALL_CATEGORIES\[" src/web/server.ts                 # 0
```

## Self-Check: PASSED

- `src/index.ts` exists and imports all adapters/use cases/jobs
- `tests/wiring/composition.test.ts` exists and 4 tests pass
- Commits `4b11c0a` and `82a2592` exist in git log
- `tsc --noEmit` exits 0
- `roundRobinIndex`/`lastSentSource`/`ALL_CATEGORIES[` count = 0 in server.ts
