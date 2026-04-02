# Sub-spec: Agent loop + UI integration

**Epic:** `opencode-lite-mcp-epic.md`
**SP:** 3
**Priority:** P3
**Depends on:** `opencode-lite-mcp--tool-discovery.md`

## Scope
Add a server-side agent/tool-call loop so the web Chat UI can execute MCP tools.

### New endpoint
- `POST /api/agent/chat` — accepts a chat request, calls model, executes tool_calls via MCP/OpenPlanner, feeds outputs back to model, repeats until stop/limit

### Flow
1. Accept chat request
2. Call model (via existing `/v1/chat/completions` pipeline)
3. If `tool_calls` returned:
   - Execute via MCP `tools/call` or OpenPlanner tools
   - Feed tool outputs back to model
   - Repeat until stop condition or max iterations
4. Return final response with tool call history

### Changes
- `src/routes/agent/index.ts` — new: agent loop endpoint
- Web Chat UI — display tool_calls and tool outputs inline
- Auth: require proxy auth token, tool execution allow-listed

### Security
- MCP tool execution disabled by default unless allow-list configured
- `MCP_TOOL_ALLOW_LIST` env var controls which tools can be invoked

## Verification
- Chat UI can invoke at least one MCP tool end-to-end
- Tool call history is displayed in the UI
- Unauthorized tool calls are rejected
