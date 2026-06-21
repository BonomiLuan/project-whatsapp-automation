---
phase: 04-multi-tenancy
plan: "01"
subsystem: database-migrations
tags: [migrations, multi-tenancy, postgres, node-pg-migrate]
dependency_graph:
  requires: []
  provides: [tenants-table, deal_history-with-tenant-id, rotation_state-table, deal_feedback-table, default-tenant-seed]
  affects: [PgDealRepository, PgTenantRepository, PgRotationStore]
tech_stack:
  added: [node-pg-migrate@^8.0.4]
  patterns: [idempotent-migrations, ifNotExists, ON CONFLICT DO NOTHING]
key_files:
  created:
    - migrations/001_initial_schema.ts
    - migrations/002_seed_default_tenant.ts
  modified:
    - package.json
decisions:
  - "down() does not drop tenants or deal_history — only rotation_state and deal_feedback — to prevent data loss on rollback (T-04-02)"
  - "deal_history.tenant_id uses DEFAULT 'default' in both createTable and addColumns to handle pre-existing rows safely (T-04-01 / Pitfall 1)"
  - "Migration 002 seeds default tenant with ON CONFLICT (id) DO NOTHING (idempotent, safe to re-run)"
metrics:
  duration: "~5 minutes"
  completed: "2026-06-21"
  tasks_completed: 2
  tasks_total: 2
  files_created: 2
  files_modified: 1
---

# Phase 4 Plan 01: node-pg-migrate Install + Initial Schema Summary

**One-liner:** Installed node-pg-migrate@8.0.4 and created two idempotent migration files — 001 creates all four multi-tenant tables with safe defaults, 002 seeds the `default` tenant from `TELEGRAM_CHAT_IDS`.

## Tasks Completed

| # | Task | Commit | Files |
|---|------|--------|-------|
| 1 | Install node-pg-migrate + migration 001_initial_schema | 3b877a5 | package.json, package-lock.json, migrations/001_initial_schema.ts |
| 2 | Migration 002_seed_default_tenant | 1c0f93d | migrations/002_seed_default_tenant.ts |

## Deviations from Plan

None — plan executed exactly as written.

## Threat Model Compliance

| Threat ID | Mitigation Applied |
|-----------|--------------------|
| T-04-01 | deal_history.tenant_id defined with `default: "'default'"` in both createTable and addColumns — existing rows are never left NULL |
| T-04-02 | down() only drops deal_feedback and rotation_state; tenants and deal_history are never dropped |
| T-04-SC | node-pg-migrate legitimacy verified by human before install (Task 0 checkpoint) |

## Known Stubs

None — migrations are complete DDL/DML with no placeholders.

## Self-Check

- [x] migrations/001_initial_schema.ts exists
- [x] migrations/002_seed_default_tenant.ts exists
- [x] package.json contains node-pg-migrate in dependencies
- [x] package.json contains "migrate" script
- [x] tsc --noEmit passes clean (zero errors)
- [x] Both files export `up` and `down` as async functions
- [x] Both commits exist: 3b877a5, 1c0f93d

## Self-Check: PASSED
