---
phase: 03-core-domain-extraction
plan: "02"
subsystem: adapters/lock, adapters/store, adapters/db
tags: [hexagonal, adapters, advisory-lock, rotation-store, deal-repository, tenant-repository, tdd]
dependency_graph:
  requires: []
  provides:
    - src/adapters/lock/PgAdvisoryLock.ts → implements Lock port (D-04)
    - src/adapters/store/InMemoryRotationStore.ts → implements RotationStore port (D-03b)
    - src/adapters/db/PgDealRepository.ts → implements DealRepository port (EXTRACT-06)
    - src/adapters/db/PgTenantRepository.ts → implements TenantRepository port (D-05c)
  affects:
    - Wave 2 use cases (consume these adapters)
    - Wave 3 composition root (wires adapters into use cases)
tech_stack:
  added: []
  patterns:
    - FNV-32 hash for deterministic string-to-integer advisory lock ID mapping
    - Defensive try/catch pattern for pre-migration SQL safety
    - In-process Map-backed store for single-instance rotation state
key_files:
  created:
    - src/adapters/store/InMemoryRotationStore.ts
    - tests/adapters/PgAdvisoryLock.test.ts
    - tests/adapters/InMemoryRotationStore.test.ts
  modified:
    - src/adapters/lock/PgAdvisoryLock.ts
    - src/adapters/db/PgDealRepository.ts
    - src/adapters/db/PgTenantRepository.ts
decisions:
  - FNV-32 hash chosen for hashKey: deterministic, cheap, matches plan spec (seed 0x811c9dc5, prime 0x01000193)
  - Math.imul used for 32-bit multiplication without BigInt overhead
  - hashKey exported as standalone function to enable IO-free unit testing without DB
  - Defensive try/catch in Pg repos returns neutral values (empty Set/[]/null) not throw, ensuring Phase-3 boot safety before Phase-4 schema migration
  - PgTenantRepository.rowToTenant defaults channels to [], filters to {minDiscount:0, categories:[], sources:[]}, affiliates to {} when absent
metrics:
  duration: ~7min
  completed: "2026-06-20"
  tasks: 2
  files: 6
---

# Phase 03 Plan 02: Adapter Stubs to Real Implementations Summary

PgAdvisoryLock implements Lock via FNV-32 hash + Postgres advisory lock; InMemoryRotationStore implements RotationStore; PgDealRepository and PgTenantRepository replace Phase-3 stubs with real parameterized SQL and defensive fallbacks.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | PgAdvisoryLock + InMemoryRotationStore (TDD) | f6b5859 | src/adapters/lock/PgAdvisoryLock.ts, src/adapters/store/InMemoryRotationStore.ts, tests/adapters/PgAdvisoryLock.test.ts, tests/adapters/InMemoryRotationStore.test.ts |
| 2 | Real SQL in PgDealRepository + PgTenantRepository | 3a54e8c | src/adapters/db/PgDealRepository.ts, src/adapters/db/PgTenantRepository.ts |

## Verification Results

- `npx vitest run tests/adapters/` — 9/9 tests passing (2 test files)
- `npx tsc --noEmit` — exits 0
- `grep -rE "from '\.\./(web|jobs)'" src/adapters/` — 0 results (no cross-boundary imports)
- No `throw new Error('Not implemented — Phase 3')` remains in db adapters

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None — all four adapters produce real behavior. PgDealRepository and PgTenantRepository fall back to empty/null on error (not a stub — this is the intended defensive pattern for Phase-3 pre-migration safety).

## Threat Flags

| Flag | File | Description |
|------|------|-------------|
| T-03-03 mitigated | PgDealRepository.ts, PgTenantRepository.ts | All SQL uses $N parameterized placeholders — no string interpolation of tenantId/dealId |
| T-03-05 mitigated | PgDealRepository.ts, PgTenantRepository.ts | try/catch returns empty Set/[]/null so boot is safe before Phase-4 schema |

## Self-Check: PASSED

- [x] src/adapters/lock/PgAdvisoryLock.ts — contains `class PgAdvisoryLock implements Lock` and `export async function withCronLock`
- [x] src/adapters/store/InMemoryRotationStore.ts — contains `class InMemoryRotationStore implements RotationStore`
- [x] src/adapters/db/PgDealRepository.ts — contains `deal_history` and `pool.query`, no stub errors
- [x] src/adapters/db/PgTenantRepository.ts — contains `pool.query`, maps rows to Tenant, no stub errors
- [x] tests/adapters/PgAdvisoryLock.test.ts — exists and passes
- [x] tests/adapters/InMemoryRotationStore.test.ts — exists and passes
- [x] Commits f6b5859 and 3a54e8c exist in git log
