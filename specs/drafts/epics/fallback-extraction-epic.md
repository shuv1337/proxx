# Epic: fallback.ts Extraction

**Status:** Partial (2 of 4 sub-specs done)
**Epic SP:** 8 (broken into 4 sub-specs ≤5 SP each)
**Priority:** P0
**Parent file:** `specs/lint-complexity-reduction/fallback-extraction.spec.md`

## Problem
`executeProviderFallback` in `src/lib/provider-strategy/fallback.ts` has cognitive complexity 399 (target <100) and 663 lines (target <200). The function handles 10+ responsibilities in deeply nested conditionals.

## Sub-specs

| # | Sub-spec | SP | Status | File |
|---|----------|----|--------|------|
| 1 | Error classifier extraction | 2 | ✅ Done | `epics/fallback-extraction--error-classifier.md` |
| 2 | Credential selector extraction | 2 | ✅ Done | `epics/fallback-extraction--credential-selector.md` |
| 3 | Response handler + orchestrator | 3 | ⬜ Not started | `epics/fallback-extraction--response-handler-orchestrator.md` |
| 4 | Early return refactor + strategy delegation | 3 | ⬜ Not started | `epics/fallback-extraction--early-return-strategy.md` |

## Execution order
1 → 2 → 3 → 4 (each sub-spec builds on the previous)

## Definition of done
- `fallback.ts` main function <200 lines, cognitive complexity <100
- Error classification logic in `error-classifier.ts` with unit tests
- Credential ordering logic in `credential-selector.ts` with unit tests
- Stream/JSON/error response handling in `response-handler.ts`
- Main loop in `orchestrator.ts` with early returns instead of nested conditionals
- All existing provider fallback tests pass
