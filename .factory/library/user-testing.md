# User Testing

Testing surface, tools, and resource cost classification.

**What belongs here:** Validation surface details, testing approach, resource measurements.

---

## Validation Surface

- **Primary surface**: Web browser at http://127.0.0.1:5174
- **Tool**: agent-browser (v0.17.1 confirmed working)
- **Backend API**: http://127.0.0.1:8789 (for curl-based XSS testing)
- **Auth**: PROXY_AUTH_TOKEN from .env required for API calls. The Vite dev server proxies `/api` and `/v1` to the backend.

## Validation Concurrency

- Machine: AMD Ryzen 9 9900X, 24 threads, 123GB RAM, 88GB available
- Vite dev server: ~100MB RAM
- Backend dev server: ~100MB RAM
- agent-browser instance: ~300MB RAM
- **Max concurrent validators: 5** (5 × 300MB + 200MB infra = 1.7GB, well within 88GB headroom)

## Testing Notes

- Dashboard renders partially without backend (shows empty states / "Unauthorized")
- Token usage assertions need proxy traffic or populated request-log data to verify non-zero values
- Layout assertions work with empty data (empty state messages still demonstrate layout)
- XSS assertions use curl against backend directly, no browser needed
- **Auth token setup**: On first dashboard load, data shows "Unauthorized" until the PROXY_AUTH_TOKEN is entered into the "Proxy Token" field in the dashboard header and saved. Flow validators using agent-browser must fill this field before testing data-dependent assertions.

## Flow Validator Guidance: Web Browser

**URL**: http://127.0.0.1:5174
**Tool**: agent-browser (invoke via Skill tool at session start)
**Session naming**: Use your session prefix + group suffix (e.g., `dc3e7c261d02__layout`)

**Isolation rules**:
- All browser-based validators share the same web server (read-only)
- No validators should modify backend data — all testing is observational
- Each validator uses its own agent-browser session
- Do NOT navigate away from the assigned pages during testing
- Take screenshots as evidence for each assertion

**Dashboard page**: http://127.0.0.1:5174 (loads dashboard by default)
**Credentials page**: http://127.0.0.1:5174/credentials
**Chat page**: http://127.0.0.1:5174/chat
**Tools page**: http://127.0.0.1:5174/tools

**Auth token for API calls**: Read from `/home/shuv/repos/proxx/.env` (PROXY_AUTH_TOKEN line)

## Flow Validator Guidance: curl

**Backend URL**: http://127.0.0.1:8789
**Auth**: Bearer token from PROXY_AUTH_TOKEN in `/home/shuv/repos/proxx/.env`
**Isolation**: curl tests are stateless and read-only, can run fully in parallel.
**OAuth callback paths**:
- `/auth/callback`
- `/api/ui/credentials/openai/oauth/browser/callback`

## Flow Validator Guidance: Unit Tests

**Command**: `cd /home/shuv/repos/proxx && pnpm test`
**Note**: This builds the project first, then runs tests. Takes ~30 seconds.
**Isolation**: Runs in its own process, no interference with other validators.
