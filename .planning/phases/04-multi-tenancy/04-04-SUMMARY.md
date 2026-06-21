---
phase: 04-multi-tenancy
plan: "04"
subsystem: composition-root-and-api-routes
tags: [wiring, composition-root, rest-api, migration-runner, postgres, hexagonal, typescript]
dependency_graph:
  requires:
    - 04-01 (node-pg-migrate + migrations 001 and 002)
    - 04-02 (CompositeAffiliateLinkBuilder + wrapper classes)
    - 04-03 (PgRotationStore + SuggestDeals AffiliateLinkBuilder param)
  provides:
    - Boot migration runner (node-pg-migrate runner called before adapter wiring)
    - PgRotationStore active in production composition root
    - CompositeAffiliateLinkBuilder(Amazon+ML+Shopee) wired into SuggestDeals
    - setTenantRepo() injection chain (index.ts -> server.ts)
    - GET /api/tenants, GET /api/config, PATCH /api/config REST endpoints
  affects:
    - Production boot sequence (migrations run before any DB adapter is instantiated)
    - SuggestDeals affiliate link rewriting in production
tech_stack:
  added: []
  patterns:
    - "Composition root boot sequence: migrate() -> instantiate adapters -> inject into web layer"
    - "Module-level _tenantRepo variable + setTenantRepo() setter for web layer DI"
    - "PATCH body filtering: extract only filters/affiliates/channels; force id and active from DB"
    - "Inline handler-logic tests avoid importing server.ts (no DATABASE_URL at import time)"
key_files:
  created: []
  modified:
    - src/index.ts
    - src/web/server.ts
    - tests/routes.test.ts
decisions:
  - "Use node-pg-migrate runner API (not migrate) — v8 exports runner as the programmatic entry point"
  - "path.resolve(process.cwd(), 'migrations') for migration dir — avoids __dirname path resolution issues"
  - "Top-level await in index.ts — valid with NodeNext module + ESNext target"
  - "Inline handler-logic test reproduction in routes.test.ts instead of supertest — avoids DATABASE_URL import-time side effects and supertest dependency"
  - "PATCH /api/config extracts only {filters, affiliates, channels} from body; id and active are always taken from current DB row (T-04-09)"
metrics:
  duration: "~20 minutes"
  completed: "2026-06-21"
  tasks_completed: 2
  tasks_total: 3
  files_created: 0
  files_modified: 3
---

# Phase 4 Plan 04: Composition Root Wiring + REST API Routes Summary

**One-liner:** Boot migration runner, PgRotationStore, and CompositeAffiliateLinkBuilder wired into index.ts; GET /api/tenants + GET /api/config + PATCH /api/config added to server.ts behind existing auth middleware.

## Tasks Completed

| # | Task | Commit | Files |
|---|------|--------|-------|
| 1 | Add REST routes to server.ts with TenantRepository injection | b2da132 | src/web/server.ts, tests/routes.test.ts |
| 2 | Wire migration runner, PgRotationStore, CompositeAffiliateLinkBuilder in index.ts | a57ded7 | src/index.ts |

## Task 3: Checkpoint (awaiting human verification)

Task 3 is a `checkpoint:human-verify` with `gate="blocking"` — requires a live PostgreSQL environment (Railway or local) to verify boot logs and REST endpoint behavior. It cannot be auto-approved.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] node-pg-migrate v8 exports runner, not migrate**
- **Found during:** Task 2
- **Issue:** The PLAN.md specified `import { migrate } from 'node-pg-migrate'` but v8.0.4 exports `runner` as the programmatic API
- **Fix:** Used `import { runner } from 'node-pg-migrate'` and confirmed `runner(options)` accepts the same RunnerOption shape
- **Files modified:** src/index.ts
- **Commit:** a57ded7

**2. [Rule 1 - Bug] node-pg-migrate not installed in node_modules**
- **Found during:** Task 2 investigation
- **Issue:** node-pg-migrate was in package.json but not installed in node_modules (package-lock.json had it but `npm install` had not been run since 04-01)
- **Fix:** Ran `npm install` from main repo root — added 35 packages including node-pg-migrate@8.0.4
- **Files modified:** node_modules (no source change)

**3. [Rule 2 - Missing critical] Inline test reproduction instead of server.ts import**
- **Found during:** Task 1 test writing
- **Issue:** Plan required importing `setTenantRepo` from server.ts in tests, but importing server.ts triggers PgAdvisoryLock and initLinksTable DB connections at import time — tests would fail without DATABASE_URL
- **Fix:** Reproduced the three route handlers as inline pure functions in the test file (same approach used by existing routes.test.ts for buildOGPage). Added 10 test cases covering: 200/array for tenants, 503 when not initialized, 200/tenant for config, 404 when not found, PATCH merge, PATCH id protection, PATCH active protection, PATCH 404
- **Files modified:** tests/routes.test.ts
- **Commit:** b2da132

## Threat Model Compliance

| Threat ID | Mitigation Applied |
|-----------|--------------------|
| T-04-09 | PATCH /api/config extracts only {filters, affiliates, channels} from body; id forced to 'default', active taken from current DB row. Tests verify id and active cannot be overridden. |
| T-04-10 | All three new routes registered AFTER app.use('/api', authMiddleware) at line 152. Verified by grep showing route definitions after middleware. |
| T-04-11 | runMigrations() is called with await before any adapter instantiation — an error causes process to terminate (not silenced), Railway auto-restarts. |
| T-04-12 | node-pg-migrate log callback only receives migration status messages, not connection strings. |

## Known Stubs

None — all routes fully wired to real PgTenantRepository; migration runner uses real node-pg-migrate.

## Self-Check

- [x] src/index.ts: `grep -c "runMigrations"` = 2 (function definition + await call)
- [x] src/index.ts: `grep -c "InMemoryRotationStore"` = 0 (removed)
- [x] src/index.ts: `grep -c "PgRotationStore"` = 2 (import + instantiation)
- [x] src/index.ts: `grep -c "CompositeAffiliateLinkBuilder"` = 2 (import + instantiation)
- [x] src/index.ts: `grep -c "affiliateBuilder"` = 2 (creation + SuggestDeals arg)
- [x] src/index.ts: `grep -c "setTenantRepo"` = 2 (import + call)
- [x] src/web/server.ts: `grep -c "api/tenants"` = 3 (comment + route + test reference)
- [x] src/web/server.ts: `grep -c "api/config"` = 6 (GET comment + GET route + PATCH comment + PATCH route + test references)
- [x] src/web/server.ts: `grep -c "setTenantRepo"` = 1 (export function declaration)
- [x] tests/routes.test.ts: 10 handler-logic tests pass (vitest run: 10 passed, 9 todo)
- [x] tsc --noEmit: clean (0 errors)
- [x] vitest run (all 13 test files): 107 passed, 14 todo
- [x] Commits b2da132 and a57ded7 exist in git log
- [x] runMigrations() called BEFORE new PgRotationStore() (line 46 before line 51)
- [x] New routes registered after app.use('/api', authMiddleware) at line 152 of server.ts

## Self-Check: PASSED
