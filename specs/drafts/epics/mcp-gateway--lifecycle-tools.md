# Sub-spec: MCP lifecycle + tool discovery

**Epic:** `mcp-gateway-epic.md`
**SP:** 3
**Priority:** P3
**Depends on:** `mcp-gateway--control-plane-config.md`

## Scope
Add tool discovery and invocation endpoints, plus auto-restart policies.

### Endpoints
- `GET /api/v1/mcp/:id/tools` — list available MCP tools (calls `tools/list` on backend)
- `POST /api/v1/mcp/:id/call` — call a specific tool by name

### Changes
- Auto-restart policy: if a server health check fails, proxx restarts it
- Fleet registration: discover MCP servers from host dashboard targets (remote hosts)
- Web console: tool browser UI for browsing and invoking MCP tools

## Verification
- `GET /api/v1/mcp/social-publisher/tools` returns tool schemas from backend
- `POST /api/v1/mcp/social-publisher/call` invokes a tool and returns result
- Failed health checks trigger auto-restart
