# Epic: Proxx MCP Gateway

**Status:** Draft
**Epic SP:** 8 (broken into 3 sub-specs ≤5 SP each)
**Priority:** P3
**Parent file:** `specs/drafts/proxx-mcp-gateway.md`

## Sub-specs

| # | Sub-spec | SP | File |
|---|----------|----|------|
| 1 | MCP registry + proxy core | 5 | `epics/mcp-gateway--registry-proxy.md` |
| 2 | MCP control-plane API + config management | 3 | `epics/mcp-gateway--control-plane-config.md` |
| 3 | MCP lifecycle + tool discovery | 3 | `epics/mcp-gateway--lifecycle-tools.md` |

## Execution order
1 → 2 → 3 (sequential)

## Definition of done
- MCP servers registered and proxied through proxx at `/mcp/<server-name>/*`
- `/api/v1/mcp/*` provides lifecycle management
- MCP servers trust proxx auth, no standalone auth
- Web console has MCP server management UI
