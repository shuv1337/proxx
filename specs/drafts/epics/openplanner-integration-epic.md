# Epic: Proxx OpenPlanner Integration

**Status:** Draft
**Epic SP:** 8 (broken into 3 sub-specs ≤5 SP each)
**Priority:** P3
**Parent file:** `specs/drafts/proxx-openplanner-integration.md`

## Sub-specs

| # | Sub-spec | SP | File |
|---|----------|----|------|
| 1 | Lake proxy + registry | 5 | `epics/openplanner-integration--proxy-registry.md` |
| 2 | Config management + lifecycle | 3 | `epics/openplanner-integration--config-lifecycle.md` |
| 3 | Session search migration | 3 | `epics/openplanner-integration--session-search-migration.md` |

## Execution order
1 → 2 → 3 (sequential)

## Definition of done
- OpenPlanner proxied at `/api/v1/lake/*`
- Proxx session search delegates to OpenPlanner
- Web console has Data Lake management page
- Compose stack deploys proxx + OpenPlanner + Chroma
