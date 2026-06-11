---
phase: 01-link-curto-whatsapp
plan: "03"
subsystem: http-routes
tags: [express, routes, og-tags, ssrf, rate-limit, lru-cache, short-link]
dependency_graph:
  requires: [src/server/links.ts, LinkEntry, initLinksTable, getLink, incrementClick, getLinks, isSsrfAllowed, buildExpiredRedirectUrl]
  provides: [GET /r/:code, GET /img/:code, GET /api/links, initLinksTable startup call]
  affects: [src/server/index.ts, tests/routes.test.ts]
tech_stack:
  added: [express-rate-limit@8.5.2 (already in main repo package.json)]
  patterns: [LRU Map eviction, x-forwarded-proto Railway HTTPS detection, fire-and-forget click increment, SSRF allowlist before outbound fetch, draft-8 rate limit headers]
key_files:
  created: []
  modified:
    - src/server/index.ts
    - tests/routes.test.ts
decisions:
  - "String(req.params.code) cast used instead of destructuring to satisfy strict TS (params type is string | string[])"
  - "buildOGPage not exported from index.ts — test coverage via string mock in routes.test.ts per plan instruction"
  - "express-rate-limit resolved from main repo node_modules (worktree shares parent module resolution)"
  - "esc() defined locally in index.ts — NOT imported from bot.ts per plan instruction"
metrics:
  duration: "3 minutes"
  completed: "2026-06-11"
  tasks: 2
  files_created: 0
  files_modified: 2
---

# Phase 01 Plan 03: HTTP Routes (redirect, image proxy, analytics) Summary

Three Express routes wired to links.ts — OG tag HTML redirect with rate limiting, SSRF-safe image proxy with LRU cache and 24h Cache-Control, and auth-protected analytics list; DDL migration runs at server startup.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Add imports, LRU cache, rate limiter, and three new routes to index.ts | bf7bea2 | src/server/index.ts |
| 2 | Update route tests from todo to real assertions | 301ab4e | tests/routes.test.ts |

## Verification Results

- `npx tsc --noEmit`: EXIT 0 (no TypeScript errors)
- `npx vitest run`: EXIT 0 — 16 passed, 14 todo across 2 test files
- `grep "app.get('/r/:code'"`: line 396 — BEFORE /api/image-proxy (line 459)
- `grep "initLinksTable"`: line 534 — inside app.listen callback
- `grep "max-age=86400"`: lines 420, 437 — in /img/:code handler (NOT 3600)
- `grep "redirectLimiter"`: lines 38, 396 — defined and applied on /r/:code
- `grep "isSsrfAllowed"`: line 424 — in /img/:code handler before axios.get
- `grep "x-forwarded-proto"`: line 52 — in getBaseUrl helper
- `/r/:code` and `/img/:code` are on `app` directly, not inside /api router scope

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] TypeScript strict type error on req.params.code**
- **Found during:** Task 1 verification (npx tsc --noEmit)
- **Issue:** `req.params.code` has type `string | string[]` in strict mode; `getLink()` and `incrementClick()` expect `string`
- **Fix:** Used `String(req.params.code)` cast in both /r/:code and /img/:code handlers
- **Files modified:** src/server/index.ts
- **Commit:** bf7bea2 (included in same task commit)

## Known Stubs

None — all DB-dependent route behaviors are explicitly marked `it.todo()` with DATABASE_URL explanation. The 2 real tests in routes.test.ts are pure string-level mock tests that pass without any infrastructure.

## Threat Flags

All mitigations from the plan's threat register are implemented:

| Threat ID | Mitigation | Status |
|-----------|-----------|--------|
| T-01-06 | isSsrfAllowed() called before axios.get in /img/:code | Implemented — line 424 |
| T-01-07 | getBaseUrl() uses x-forwarded-proto for Railway HTTPS | Implemented — line 52 |
| T-01-08 | redirectLimiter: 60 req/min/IP, draft-8 headers | Implemented — lines 38, 396 |
| T-01-10 | /api/links under existing app.use('/api', isAuthenticated) | Implemented — line 448 (after middleware at line 52) |

No new security surface introduced beyond what the threat model covers.

## Self-Check: PASSED

- src/server/index.ts modified: FOUND
- tests/routes.test.ts modified: FOUND
- Commit bf7bea2 (Task 1): FOUND
- Commit 301ab4e (Task 2): FOUND
- tsc --noEmit: EXIT 0
- vitest run: EXIT 0 (16 passed, 14 todo)
