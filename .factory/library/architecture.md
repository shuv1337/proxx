# Architecture

Architectural decisions, patterns, and codebase structure notes.

**What belongs here:** Module responsibilities, data flow patterns, key abstractions.

---

- **Backend**: Fastify 4 server in `src/app.ts` (33KB). All routes registered in `createApp()`.
- **Provider strategy**: `src/lib/provider-strategy.ts` (57KB) — core dispatch logic, streaming, protocol translation, retries, fallback.
- **UI routes**: `src/lib/ui-routes.ts` — API endpoints for the web dashboard, OAuth callback HTML rendering.
- **Frontend**: React 18 + Vite in `web/`. Pages: Dashboard, Chat, Credentials, Tools.
- **Styling**: Plain CSS in `web/src/styles.css`. No CSS-in-JS or preprocessors.
- **Tests**: `src/tests/` using Node.js built-in `node:test` runner. Main test file is `proxy.test.ts` (~181KB).
- **Data flow for tokens**: API response → `extractUsageCounts()` → `updateUsageCountsFromResponse()` → `RequestLogStore.update()` → `buildUsageOverview()` → Dashboard API → React components.
