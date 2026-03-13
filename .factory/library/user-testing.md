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
