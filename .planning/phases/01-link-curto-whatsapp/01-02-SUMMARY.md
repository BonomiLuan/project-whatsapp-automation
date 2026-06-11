---
phase: 01-link-curto-whatsapp
plan: "02"
subsystem: storage
tags: [postgres, pg, links, ssrf, short-link, tdd]
dependency_graph:
  requires: []
  provides: [src/server/links.ts, LinkEntry interface, initLinksTable, createLink, getLink, incrementClick, getLinks, isSsrfAllowed, buildExpiredRedirectUrl]
  affects: [src/server/index.ts, src/telegram/bot.ts]
tech_stack:
  added: [pg@8.21.0, vitest@4.1.8]
  patterns: [pg Pool with Railway DATABASE_URL, parameterized SQL, hostname-regex SSRF allowlist, crypto.randomBytes code generation]
key_files:
  created:
    - src/server/links.ts
    - tests/links.test.ts
    - vitest.config.ts
  modified:
    - package.json
    - package-lock.json
decisions:
  - "SSRF allowlist uses hostname regex (not URL.includes) to prevent auth@ and port bypass"
  - "incrementClick swallows errors so redirect flow never breaks on click-tracking failure"
  - "buildExpiredRedirectUrl defaults ML publisher_id to 64897511 and matt_word to mamaeeconomica matching existing mercadoLivreAffiliate.ts constants"
  - "vitest installed in worktree; vitest.config.ts created with ESM/NodeNext config"
metrics:
  duration: "8 minutes"
  completed: "2026-06-11"
  tasks: 1
  files_created: 3
  files_modified: 2
---

# Phase 01 Plan 02: links.ts Postgres Storage Module Summary

Postgres storage module for short links — Pool with Railway DATABASE_URL, parameterized CRUD, 5-char code generation with collision retry, SSRF hostname allowlist, affiliate URL domain validation, and expired-link platform search URL builder.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 RED | Add failing tests for isSsrfAllowed and buildExpiredRedirectUrl | dd8a5c6 | tests/links.test.ts, vitest.config.ts, package.json, package-lock.json |
| 1 GREEN | Implement src/server/links.ts | d4d3829 | src/server/links.ts |

## TDD Gate Compliance

- RED gate: `test(01-02)` commit dd8a5c6 — tests fail with `ERR_MODULE_NOT_FOUND`
- GREEN gate: `feat(01-02)` commit d4d3829 — 14 tests pass, 5 todo (DB-dependent)

## Verification Results

- `npx vitest run tests/links.test.ts`: 14 passed, 5 todo — EXIT 0
- `npx tsc --noEmit`: EXIT 0 (no TypeScript errors)
- `grep -c "export" src/server/links.ts`: 8 (>= 7 required)
- All `pool.query()` calls use `$1`/`$2` parameterized form — verified by grep

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None — all DB-dependent tests are explicitly marked `it.todo()` with reason. Pure-function tests (isSsrfAllowed, buildExpiredRedirectUrl) are fully implemented and passing.

## Threat Flags

No new security surface beyond what the plan's threat model covers.

| Mitigation | Status |
|------------|--------|
| T-01-02: Parameterized SQL | Implemented — all pool.query calls use $1/$2 |
| T-01-03: SSRF hostname allowlist | Implemented — isSsrfAllowed() with 5 regex patterns |
| T-01-04: affiliateUrl domain allowlist | Implemented — ALLOWED_AFFILIATE_PREFIXES starts-with check in createLink() |

## Self-Check: PASSED

- src/server/links.ts: FOUND
- tests/links.test.ts: FOUND
- vitest.config.ts: FOUND
- Commit dd8a5c6 (RED): FOUND
- Commit d4d3829 (GREEN): FOUND
