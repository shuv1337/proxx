# Epic: Control-plane slice: federation v1

**Status:** Partial (Phases A-B mostly done)
**Epic SP:** 8 (broken into 4 sub-specs ≤5 SP each)
**Priority:** P1
**Parent file:** `specs/drafts/control-plane-slice-federation-v1.md`

## Current state
- ✅ Canonical `/api/v1/federation/self`, `peers`, `bridges`, `accounts` use modular route layer
- ✅ Web console uses `/api/v1/federation/*`
- 🚧 `sync/pull` still targets legacy `/api/ui/federation/sync/pull`
- 🚧 Advanced routes (projected-accounts/routed, imported, import-all, usage-export, usage-import, sync/pull) still in `ui-routes.ts`

## Sub-specs

| # | Sub-spec | SP | File |
|---|----------|----|------|
| 1 | Advanced federation route extraction | 3 | `epics/federation-slice--advanced-routes.md` |
| 2 | Bridge relay lifecycle extraction | 3 | `epics/federation-slice--bridge-relay-lifecycle.md` |
| 3 | Federation parity tests + legacy alias verification | 2 | `epics/federation-slice--parity-tests.md` |

## Execution order
1 → 2 → 3 (can parallelize 1 and 2)

## Definition of done
- All federation routes available under `/api/v1/federation/*`
- Bridge upgrade/runtime wiring no longer in `ui-routes.ts`
- `/api/ui/federation/*` routes are aliases only
- Parity tests confirm `/api/ui/*` and `/api/v1/*` return identical responses
