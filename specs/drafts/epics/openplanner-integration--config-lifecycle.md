# Sub-spec: Config management + lifecycle

**Epic:** `openplanner-integration-epic.md`
**SP:** 3
**Priority:** P3
**Depends on:** `openplanner-integration--proxy-registry.md`

## Scope
Add config management and lifecycle endpoints for OpenPlanner.

### Endpoints
- `GET /api/v1/lake/config` — OpenPlanner configuration
- `PUT /api/v1/lake/config` — update configuration (persisted to SQL)
- `GET /api/v1/lake/stats` — session/event/vector counts
- `POST /api/v1/lake/compact` — trigger semantic compaction
- `POST /api/v1/lake/start|stop|restart` — lifecycle management
- `GET /api/v1/lake/logs` — tail logs

### Changes
- `src/lib/lake-config.ts` — config persistence and validation
- Web console — add Data Lake config/status page

## Verification
- `PUT /api/v1/lake/config` persists and triggers OpenPlanner reload
- `GET /api/v1/lake/stats` returns counts
- Lifecycle endpoints work via compose integration
