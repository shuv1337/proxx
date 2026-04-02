# Sub-spec: MCP registry + proxy core

**Epic:** `mcp-gateway-epic.md`
**SP:** 5
**Priority:** P3
**Depends on:** nothing

## Scope
Implement the MCP server registry and reverse proxy that routes `/mcp/<server-name>/*` to backend MCP servers.

### New files
- `src/lib/mcp-registry.ts` — `McpServerRegistry` class that discovers servers from compose/PM2, tracks health
- `src/lib/mcp-proxy.ts` — reverse proxy logic for MCP traffic (Streamable HTTP + SSE passthrough)

### Changes
- `src/routes/mcp/index.ts` — implement proxy router (currently empty stub) that routes `/mcp/:serverName/*`
- `src/routes/api/v1/index.ts` — register MCP control-plane routes (list endpoint)
- `docker-compose.yml` — add `mcp-social-publisher` as first co-deployed MCP server
- `mcp-social-publisher` — add `/health` endpoint, bind to localhost only

### Auth
- Proxx handles auth (bearer token or tenant API key)
- Backend servers trust proxx via `X-Forwarded-User` / `X-Tenant-Id` headers
- Unauthenticated requests to `/mcp/*` return 401

## Verification
- `GET /mcp/social-publisher/mcp` proxies to backend and returns MCP protocol response
- `GET /api/v1/mcp` returns registered servers with status
- Unauthenticated requests return 401
