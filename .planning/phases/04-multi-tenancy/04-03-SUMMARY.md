---
phase: 04-multi-tenancy
plan: "03"
subsystem: usecases-and-store-adapters
tags: [postgres, rotation-store, affiliate-link, suggest-deals, hexagonal, tdd, vitest]
dependency_graph:
  requires:
    - 04-01 (rotation_state table from migration 001_initial_schema)
    - 04-02 (AffiliateLinkBuilder port and CompositeAffiliateLinkBuilder)
  provides:
    - PgRotationStore (persisted RotationStore backed by rotation_state table)
    - SuggestDeals with optional 4th AffiliateLinkBuilder param
  affects:
    - 04-04 (root composition will inject PgRotationStore + CompositeAffiliateLinkBuilder into SuggestDeals)
tech_stack:
  added: []
  patterns:
    - "Upsert via INSERT ... ON CONFLICT (tenant_id) DO UPDATE for idempotent rotation cursor persistence"
    - "Optional constructor injection for AffiliateLinkBuilder (no adapter imports in core)"
    - "TDD: failing test committed before implementation in both tasks"
key_files:
  created:
    - src/adapters/store/PgRotationStore.ts
    - tests/adapters/PgRotationStore.test.ts
  modified:
    - src/core/usecases/SuggestDeals.ts
    - tests/usecases/SuggestDeals.test.ts
decisions:
  - "PgRotationStore accepts an optional pool constructor param (defaults to shared pool) so tests inject a fake pool without vi.mock"
  - "AffiliateLinkBuilder param is optional (?) in SuggestDeals so src/index.ts instantiation with 3 args is unchanged until 04-04"
  - "Affiliate build() is called BEFORE publisher.publish() and AFTER the final deal selection + null guard"
metrics:
  duration: "~8 minutes"
  completed: "2026-06-21"
  tasks_completed: 2
  tasks_total: 2
  files_created: 2
  files_modified: 2
---

# Phase 4 Plan 03: PgRotationStore and SuggestDeals AffiliateLinkBuilder Summary

**One-liner:** PgRotationStore persists rotation cursor via PostgreSQL upsert; SuggestDeals gains an optional 4th AffiliateLinkBuilder param that rewrites deal URLs between selection and publish.

## Tasks Completed

| # | Task | Commit | Files |
|---|------|--------|-------|
| 1 | Criar PgRotationStore com testes de unidade | fc563fb | src/adapters/store/PgRotationStore.ts, tests/adapters/PgRotationStore.test.ts |
| 2 | Adicionar AffiliateLinkBuilder como 4° parâmetro opcional em SuggestDeals | 930fe09 | src/core/usecases/SuggestDeals.ts, tests/usecases/SuggestDeals.test.ts |

## Deviations from Plan

None — plan executed exactly as written.

## TDD Gate Compliance

Both tasks followed the RED/GREEN cycle:
- Task 1: test file written first (module-not-found error), then PgRotationStore implemented → 5 tests pass
- Task 2: 2 new test cases added before SuggestDeals changes (2 fail, 6 pass), then implementation → 8 tests pass

## Threat Model Compliance

| Threat ID | Mitigation Applied |
|-----------|--------------------|
| T-04-06 | tenantId passed as $1 parameterized placeholder — no string interpolation in SQL |
| T-04-07 | Accepted — single-process MVP; upsert race documented |
| T-04-08 | Accepted — passthrough when supports() returns false is correct behavior |

## Known Stubs

None — PgRotationStore is fully wired to real SQL; SuggestDeals affiliate injection is complete.

## Self-Check

- [x] src/adapters/store/PgRotationStore.ts created and exports PgRotationStore
- [x] tests/adapters/PgRotationStore.test.ts created with 5 test cases (all pass)
- [x] vitest run tests/adapters/PgRotationStore.test.ts: 5 passed, 0 failed
- [x] grep -c "ON CONFLICT" src/adapters/store/PgRotationStore.ts = 2 (1 comment + 1 SQL clause)
- [x] src/core/usecases/SuggestDeals.ts has affiliateBuilder 3 occurrences (import type, constructor param, conditional call)
- [x] vitest run tests/usecases/SuggestDeals.test.ts: 8 passed, 0 failed (6 existing + 2 new)
- [x] tsc --noEmit: clean
- [x] Commits fc563fb and 930fe09 exist in git log
- [x] No adapters/ imports added to SuggestDeals.ts (core boundary maintained)

## Self-Check: PASSED
