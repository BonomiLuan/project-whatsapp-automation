---
phase: 01
slug: link-curto-whatsapp
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-11
---

# Phase 01 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (none detected — Wave 0 installs) |
| **Config file** | `vitest.config.ts` — Wave 0 creates |
| **Quick run command** | `npx vitest run --reporter=verbose` |
| **Full suite command** | `npx vitest run` |
| **Estimated runtime** | ~10 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run --reporter=verbose`
- **After every plan wave:** Run `npx vitest run`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** ~10 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 01-links-init | links | 1 | REQ-01 | — | N/A | integration | `npx vitest run tests/links.test.ts` | ❌ W0 | ⬜ pending |
| 01-code-gen | links | 1 | REQ-02 | — | N/A | unit | `npx vitest run tests/links.test.ts` | ❌ W0 | ⬜ pending |
| 01-route-redirect | routes | 2 | REQ-03 | T-01-03 | Returns 200 HTML, not 302 | integration | `npx vitest run tests/routes.test.ts` | ❌ W0 | ⬜ pending |
| 01-route-redirect-404 | routes | 2 | REQ-03 | — | N/A | integration | `npx vitest run tests/routes.test.ts` | ❌ W0 | ⬜ pending |
| 01-route-img | routes | 2 | REQ-04 | T-01-04 | SSRF allowlist enforced | integration | `npx vitest run tests/routes.test.ts` | ❌ W0 | ⬜ pending |
| 01-ssrf-block | links | 1 | REQ-04 | T-01-04 | Blocked domain returns 403 | unit | `npx vitest run tests/links.test.ts` | ❌ W0 | ⬜ pending |
| 01-analytics-unauth | routes | 2 | REQ-07 | T-01-07 | Unauthenticated → 401 | integration | `npx vitest run tests/routes.test.ts` | ❌ W0 | ⬜ pending |
| 01-analytics-auth | routes | 2 | REQ-07 | — | N/A | integration | `npx vitest run tests/routes.test.ts` | ❌ W0 | ⬜ pending |
| 01-bot-wizard | bot | 3 | REQ-05 | — | N/A | manual | Manual Telegram test | — | ⬜ pending |
| 01-bot-auto | bot | 3 | REQ-06 | — | N/A | manual | Manual send to test chat | — | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/links.test.ts` — stubs for REQ-01 (initLinksTable), REQ-02 (generateCode), REQ-04 (SSRF isSsrfAllowed)
- [ ] `tests/routes.test.ts` — stubs for REQ-03 (/r/:code 200 + OG, 404), REQ-04 (/img/:code 200, SSRF 403), REQ-07 (/api/links 401, 200)
- [ ] `vitest.config.ts` — test framework config (ESM + TypeScript)
- [ ] `npm install --save-dev vitest` — test runner installation

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Wizard manual — caption contains `ofertas.thaisbonomi.com.br/r/` | REQ-05 | Requires live Telegram bot interaction | Send a product via Telegram wizard; copy caption from resulting message; verify URL format |
| Auto deal send — caption contains short link | REQ-06 | Requires live deal aggregation + chat group | Trigger `/buscar-shopee` or wait for auto send; inspect caption |
| WhatsApp OG preview renders correctly | REQ-03 | WhatsApp caching + crawler behavior not testable in unit tests | Paste the short link into a WhatsApp message; verify preview card shows title + image |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 10s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
