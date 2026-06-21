---
phase: 04-multi-tenancy
plan: 02
subsystem: api
tags: [affiliate, composite-pattern, hexagonal, typescript, vitest]

requires:
  - phase: 04-multi-tenancy
    provides: AffiliateLinkBuilder port (AffiliateLinkBuilder.ts) and domain types (Deal, Marketplace, AffiliateConfig)

provides:
  - AmazonAffiliateLinkBuilder class wrapping injectAmazonTag
  - MLAffiliateLinkBuilder class wrapping injectMLTag
  - ShopeeAffiliateLinkBuilder class wrapping generateAffiliateLink
  - CompositeAffiliateLinkBuilder with delegation + passthrough semantics

affects:
  - 04-03-PLAN (SuggestDeals use case that will inject CompositeAffiliateLinkBuilder)
  - 04-multi-tenancy

tech-stack:
  added: []
  patterns:
    - "Composite pattern: CompositeAffiliateLinkBuilder.build() delegates to adapters.find(supports) with passthrough when no match"
    - "Wrapper adapter: existing exported functions wrapped in classes implementing AffiliateLinkBuilder port"

key-files:
  created:
    - src/adapters/affiliates/CompositeAffiliateLinkBuilder.ts
    - tests/adapters/CompositeAffiliateLinkBuilder.test.ts
  modified:
    - src/adapters/affiliates/AmazonAffiliate.ts
    - src/adapters/affiliates/MLAffiliate.ts
    - src/adapters/affiliates/ShopeeAffiliate.ts

key-decisions:
  - "Wrapper classes appended to existing affiliate adapter files without modifying existing exports"
  - "CompositeAffiliateLinkBuilder uses adapters.find() (first match wins) rather than reduce to prevent double-injection"
  - "Passthrough returns deal reference unchanged (not a copy) when no adapter matches"

patterns-established:
  - "Composite AffiliateLinkBuilder: inject array of builders, delegate via find(supports), passthrough on no-match"

requirements-completed:
  - TENANT-07

duration: 15min
completed: 2026-06-21
---

# Phase 04 Plan 02: AffiliateLinkBuilder Wrapper Classes and Composite Summary

**Three affiliate adapter wrapper classes (Amazon/ML/Shopee) plus CompositeAffiliateLinkBuilder with delegation and passthrough, enabling SuggestDeals to inject an AffiliateLinkBuilder without knowing which marketplace is active**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-06-21T00:00:00Z
- **Completed:** 2026-06-21T00:05:00Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments

- Appended `AmazonAffiliateLinkBuilder`, `MLAffiliateLinkBuilder`, and `ShopeeAffiliateLinkBuilder` to their respective adapter files, implementing `supports()` and `build()` without touching existing exported functions
- Created `CompositeAffiliateLinkBuilder` implementing the Composite pattern: `supports()` via `some`, `build()` via `find` with passthrough when no adapter matches
- 5 vitest tests covering supports-true, supports-false, build-delegation, build-passthrough, and first-adapter-wins behaviors — all pass; `tsc --noEmit` is clean

## Task Commits

Each task was committed atomically:

1. **Task 1: Add AffiliateLinkBuilder wrapper classes** - `bd71aec` (feat)
2. **Task 2: Create CompositeAffiliateLinkBuilder** - `4f397e0` (feat)

## Files Created/Modified

- `src/adapters/affiliates/AmazonAffiliate.ts` - Added `AmazonAffiliateLinkBuilder` class at end of file
- `src/adapters/affiliates/MLAffiliate.ts` - Added `MLAffiliateLinkBuilder` class at end of file
- `src/adapters/affiliates/ShopeeAffiliate.ts` - Added `ShopeeAffiliateLinkBuilder` class at end of file
- `src/adapters/affiliates/CompositeAffiliateLinkBuilder.ts` - New file: Composite delegating to array of AffiliateLinkBuilder
- `tests/adapters/CompositeAffiliateLinkBuilder.test.ts` - New file: 5 test cases with inline stubs

## Decisions Made

- Wrapper classes appended to existing files (not extracted to new files) to minimize diff surface and avoid breaking other importers
- `CompositeAffiliateLinkBuilder` uses `find()` (first match wins) — multiple adapters supporting the same marketplace is an edge case; the first registered one takes priority
- `build()` returns the deal reference unchanged (not a spread copy) on passthrough to preserve object identity for callers that do reference comparison

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `CompositeAffiliateLinkBuilder` is ready to be injected into `SuggestDeals` use case (04-03)
- All three marketplace adapters available via their wrapper classes
- No blockers

---
*Phase: 04-multi-tenancy*
*Completed: 2026-06-21*
