---
phase: 02-hexagonal-structure
plan: 01
subsystem: infra
tags: [typescript, hexagonal-architecture, ports-adapters, domain-types, node-cron]

# Dependency graph
requires: []
provides:
  - "src/core/domain/ — Deal, Filter, Tenant types (exact spec shapes)"
  - "src/core/ports/ — 10 port interfaces (DealScraper, DealPublisher, AffiliateLinkBuilder, DealRepository, TenantRepository, LinkResolver, RotationStore, FeedbackRepository, Scheduler, Lock)"
  - "src/adapters/scheduler/NodeCronScheduler.ts — implements Scheduler port"
  - "Directory scaffold: src/core/usecases/, src/web/middleware/, src/web/routes/api/, src/web/routes/redirect/, src/adapters/{scrapers,publishers,affiliates,db,lock,scheduler}/, src/jobs/"
affects:
  - "02-02 (characterization tests) — imports Deal, Filter, Tenant types"
  - "02-03 (PelandoScraper) — implements DealScraper port"
  - "02-04 (TelegramPublisher) — implements DealPublisher port"
  - "02-05 (use cases) — depends on all 10 ports"
  - "02-06 (composition root) — wires NodeCronScheduler into jobs"

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Hexagonal (Ports & Adapters): core never imports adapters; dependency arrows point inward"
    - "ESM import paths use .js extension per TypeScript NodeNext convention"
    - "Port interfaces are pure TypeScript interfaces — no runtime code, no coupling"

key-files:
  created:
    - src/core/domain/Deal.ts
    - src/core/domain/Filter.ts
    - src/core/domain/Tenant.ts
    - src/core/ports/DealScraper.ts
    - src/core/ports/DealPublisher.ts
    - src/core/ports/AffiliateLinkBuilder.ts
    - src/core/ports/DealRepository.ts
    - src/core/ports/TenantRepository.ts
    - src/core/ports/LinkResolver.ts
    - src/core/ports/RotationStore.ts
    - src/core/ports/FeedbackRepository.ts
    - src/core/ports/Scheduler.ts
    - src/core/ports/Lock.ts
    - src/adapters/scheduler/NodeCronScheduler.ts
  modified: []

key-decisions:
  - "All type signatures reproduced verbatim from spec (D-02b) — zero deviation"
  - "NodeCronScheduler.name parameter accepted but unused in Phase 2 (logging deferred to Phase 3)"
  - "RotationCursor and CategoryStats defined as exported types alongside their port interfaces"

patterns-established:
  - "Domain types: plain TypeScript types (not classes/interfaces) with export keyword"
  - "Port files: one interface per file, single responsibility"
  - "Adapter stubs: implements port interface, minimal body, no wiring to composition root yet"

requirements-completed:
  - STRUCT-01
  - STRUCT-02
  - STRUCT-03
  - STRUCT-09
  - STRUCT-10

# Metrics
duration: 15min
completed: 2026-06-17
---

# Phase 02 Plan 01: Hexagonal Skeleton Summary

**Core domain types (Deal, Filter, Tenant) and 10 port interfaces scaffolded with exact spec signatures; NodeCronScheduler stub wires node-cron behind the Scheduler port; tsc --noEmit passes on all 3 commits**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-06-17T13:23:00Z
- **Completed:** 2026-06-17T13:25:00Z
- **Tasks:** 3
- **Files created:** 14 (+ 4 .gitkeep, 13 empty directories)

## Accomplishments

- Created `src/core/domain/` with Deal, Filter, Tenant types matching spec verbatim
- Created `src/core/ports/` with all 10 port interfaces including supporting types (RotationCursor, CategoryStats)
- Created `src/adapters/scheduler/NodeCronScheduler.ts` implementing the Scheduler port via node-cron
- Scaffolded full directory tree (core, adapters, web, jobs) that all subsequent plans plug into
- tsc --noEmit passed after every commit; existing 16 tests still pass

## Task Commits

1. **Task 1: Create directory scaffold and domain types** - `77f4ad7` (feat)
2. **Task 2: Create all 10 port interfaces** - `faeca59` (feat)
3. **Task 3: Create NodeCronScheduler stub** - `53a75a6` (feat)

## Files Created/Modified

- `src/core/domain/Deal.ts` — Marketplace union type + Deal object type
- `src/core/domain/Filter.ts` — Filter type (keywords, excludeKeywords, minDiscount, categories)
- `src/core/domain/Tenant.ts` — Channel, AffiliateConfig, Tenant types (imports Filter via .js)
- `src/core/ports/DealScraper.ts` — fetchDeals(category?) → Promise<Deal[]>
- `src/core/ports/DealPublisher.ts` — publish(deal, tenant) → Promise<void>
- `src/core/ports/AffiliateLinkBuilder.ts` — supports(marketplace) + build(deal, config) → Promise<Deal>
- `src/core/ports/DealRepository.ts` — findRecentlySentIds + markAsSent
- `src/core/ports/TenantRepository.ts` — findAll + findById + save
- `src/core/ports/LinkResolver.ts` — resolve(code) + create(url, meta)
- `src/core/ports/RotationStore.ts` — RotationCursor type + load/save/reset
- `src/core/ports/FeedbackRepository.ts` — CategoryStats type + record/statsByCategory
- `src/core/ports/Scheduler.ts` — schedule(name, cron, job)
- `src/core/ports/Lock.ts` — withLock<T>(key, fn) → Promise<T | null>
- `src/adapters/scheduler/NodeCronScheduler.ts` — implements Scheduler via node-cron

## Decisions Made

- Followed spec D-02b strictly: all signatures reproduced verbatim with zero deviation
- `NodeCronScheduler.name` parameter accepted but unused (tracing/logging deferred to Phase 3, per CONTEXT.md)

## Deviations from Plan

None — plan executed exactly as written.

## Issues Encountered

None.

## Known Stubs

- `src/adapters/scheduler/NodeCronScheduler.ts` — `name` parameter unused intentionally (Phase 2 stub; logging comes in Phase 3). Does not affect plan goal (interface satisfied, tsc passes).

## Threat Flags

None — plan 01 creates new files only; no I/O, no external calls, no trust boundary changes.

## Self-Check: PASSED

- `src/core/domain/Deal.ts` — FOUND
- `src/core/domain/Filter.ts` — FOUND
- `src/core/domain/Tenant.ts` — FOUND
- `src/core/ports/Lock.ts` — FOUND (10/10 ports confirmed)
- `src/adapters/scheduler/NodeCronScheduler.ts` — FOUND
- Commits 77f4ad7, faeca59, 53a75a6 — FOUND in git log

## Next Phase Readiness

- All contracts (ports) are in place; plans 02-06 can reference types and interfaces directly
- NodeCronScheduler is a stub awaiting wiring in the composition root (plan 06)
- No blockers for parallel wave 1 agents (plans 02-06 depend only on the types created here)

---
*Phase: 02-hexagonal-structure*
*Completed: 2026-06-17*
