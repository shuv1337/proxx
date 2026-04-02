# Sub-spec: OpenAPI ownership + ui-routes.ts removal

**Epic:** `contract-deprecation-epic.md`
**Epic SP:** 4 (broken into 2 sub-specs ≤3 SP each)
**Priority:** P0
**Status:** Partial (deprecation headers done, removal blocked)

## What's done
- ✅ Frontend migrated to `/api/v1/*`
- ✅ Deprecation headers live
- ✅ `ui-routes.ts` is a 62-line thin barrel

## Remaining (broken into sub-tasks)

| # | Task | SP | Status |
|---|------|----|--------|
| 1 | Migrate 2 test files from `registerUiRoutes` to `registerApiV1Routes` | 2 | ⬜ |
| 2 | Remove `registerUiRoutes` from app.ts + delete `ui-routes.ts` | 2 | ⬜ blocked by #1 |

### Task 1: Test migration (2 SP)
Files to migrate:
- `src/tests/tenant-provider-policy-routes.test.ts` — 9 calls to `registerUiRoutes`, 11 test URLs use `/api/ui/*`
- `src/tests/federation-bridge-relay.test.ts` — 2 calls to `registerUiRoutes`

Replace: `import { registerUiRoutes }` → `import { registerApiV1Routes }` (or equivalent)
Replace: `/api/ui/` URLs → `/api/v1/` equivalents
The route registration functions accept a prefix-aware deps object, so the URL change is the primary task.

### Task 2: Remove legacy layer (2 SP)
After tests pass with `/api/v1/*`:
1. Remove `registerUiRoutes` call from `app.ts`
2. Delete `src/lib/ui-routes.ts`
3. Remove `LEGACY_*_ROUTE_PREFIX` constants from route modules
4. Remove `/api/ui/*` route registrations from route modules

## Scope
Final cleanup: make `/api/v1/openapi.json` control-plane-filtered and remove `ui-routes.ts`.

### Changes
1. Ensure `/api/v1/openapi.json` serves the control-plane OpenAPI spec (or document why whole-app is preferred in v1)
2. Remove `registerUiRoutes` call from `app.ts`
3. Delete `src/lib/ui-routes.ts` (currently 62 lines, setup-only barrel)
4. Remove `/api/ui/*` route registrations from all route modules
5. Remove `LEGACY_*_ROUTE_PREFIX` constants

### Pre-removal checklist
- [ ] All frontend callsites migrated to `/api/v1/*`
- [ ] All parity tests pass
- [ ] Deprecation headers confirmed working
- [ ] No other code imports from `ui-routes.ts`

## Verification
- `rg "ui-routes" src/` returns zero results
- `rg "/api/ui/" src/` returns zero results
- `/api/v1/openapi.json` is accessible
- 162/162 proxy tests pass
