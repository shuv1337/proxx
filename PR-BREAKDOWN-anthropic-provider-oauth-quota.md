# PR-Sized Breakdown: Anthropic OAuth + Quota

This document breaks `PLAN-anthropic-provider-oauth-quota.md` into mergeable, reviewable PRs.

## Pre-flight gate (not a PR)

Before opening PR 1, confirm:

- Anthropic authorize endpoint
- token endpoint
- refresh-token format
- required scopes for quota access
- quota endpoint URL
- required headers, including `anthropic-version` and `anthropic-beta`
- whether Anthropic device flow exists

If device flow is not real, keep the entire rollout browser-only.

---

## PR 1 — Fix generic OAuth persistence parity

**Goal:** Correct the existing file/SQL mismatch for OAuth metadata before Anthropic depends on it.

### Include

- SQL migration to add `subject` to `accounts`
- schema version bump + migration wiring
- SQL query/type updates to read/write `subject`
- SQL `upsertOAuthAccount(...)` actually persisting `subject`
- JSON seeder updates to preserve `email` and `subject`
- persistence tests for SQL + seeding behavior

### Files likely touched

- `src/lib/db/schema.ts`
- `src/lib/db/sql-credential-store.ts`
- `src/lib/db/json-seeder.ts`
- `src/lib/runtime-credential-store.ts` if needed for parity
- `src/tests/*` covering persistence

### Explicitly do not include

- Anthropic-specific OAuth code
- route changes
- UI changes
- quota changes

### Acceptance criteria

- file-backed and SQL-backed OAuth metadata behave the same for `email`, `subject`, `planType`
- seeding no longer drops `email` / `subject`
- tests cover the new SQL behavior

### Validation

- `pnpm test`
- `pnpm typecheck`
- `pnpm build`

---

## PR 2 — Add Anthropic OAuth core + provider-aware refresh dispatch

**Goal:** Add the Anthropic OAuth manager and make refresh dispatch safe before any Anthropic accounts can exist.

### Include

- Anthropic config in `src/lib/config.ts`
  - issuer
  - client id
  - scopes
  - beta header override if needed by shared logic
- new `src/lib/anthropic-oauth.ts`
  - browser OAuth start
  - callback code exchange
  - refresh-token exchange
  - metadata extraction
  - stable initial account identity derivation
- provider-aware OAuth refresh dispatch in `src/app.ts`
  - `factory` -> Factory refresh
  - `openai` -> OpenAI refresh
  - `anthropic` -> Anthropic refresh
  - unknown OAuth provider -> log + skip
- background refresh continues to work through the provider-aware dispatcher
- unit tests for Anthropic OAuth core
- tests covering refresh dispatch behavior
- telemetry for Anthropic OAuth start/exchange/refresh/failure paths

### Files likely touched

- `src/lib/config.ts`
- `src/lib/anthropic-oauth.ts`
- `src/app.ts`
- `src/tests/anthropic-oauth.test.ts`
- `src/tests/...` for refresh dispatch

### Explicitly do not include

- UI routes
- callback allowlist changes
- quota fetching
- UI integration

### Acceptance criteria

- Anthropic refresh no longer falls through to OpenAI refresh
- provider-aware refresh behavior is test-covered
- no regression in OpenAI or Factory refresh behavior

### Validation

- `pnpm test`
- `pnpm typecheck`
- `pnpm build`

---

## PR 3 — Add Anthropic browser OAuth backend routes

**Goal:** Make Anthropic browser OAuth usable from the backend without touching quota/UI yet.

### Include

- `POST /api/ui/credentials/anthropic/oauth/browser/start`
- `GET /auth/anthropic/callback`
- persistence of Anthropic OAuth accounts via shared credential store
- `/auth/anthropic/callback` added to unauthenticated callback allowlist in `src/app.ts`
- route/integration tests for browser start + callback
- telemetry/logging for route entry/success/failure

### Files likely touched

- `src/lib/ui-routes.ts`
- `src/app.ts`
- `src/tests/proxy.test.ts` or focused route test files

### Explicitly do not include

- Anthropic device flow unless pre-flight research proves it exists
- Anthropic quota
- credentials page changes

### Acceptance criteria

- browser OAuth flow can start
- callback succeeds and persists an Anthropic account
- callback works without normal proxy auth
- existing OpenAI and Factory browser OAuth routes still work

### Validation

- `pnpm test`
- `pnpm typecheck`
- `pnpm build`

---

## PR 4 — Refactor quota DTOs/UI to be provider-agnostic (OpenAI only)

**Goal:** Remove OpenAI-specific quota assumptions before adding Anthropic quota support.

### Include

- refactor backend/client quota DTOs from `fiveHour` / `weekly` to generic `windows: []`
- keep OpenAI quota semantics intact while changing the transport shape
- refactor `web/src/lib/api.ts` quota types
- refactor `web/src/pages/CredentialsPage.tsx` to render labels from data
- replace OpenAI-only UI copy such as:
  - `Codex quota`
  - `Refresh Codex quotas`
- keep current OpenAI quota fetching behavior working after the refactor
- add or update tests for the refactored OpenAI quota shape where practical

### Files likely touched

- `src/lib/openai-quota.ts`
- `src/lib/ui-routes.ts` if response shape changes there
- `web/src/lib/api.ts`
- `web/src/pages/CredentialsPage.tsx`
- `web/src/styles.css`
- related backend tests

### Explicitly do not include

- Anthropic quota fetches
- Anthropic UI controls
- Anthropic route additions beyond what already landed in PR 3

### Acceptance criteria

- credentials page still renders OpenAI quota correctly
- quota rendering is driven by data labels, not hard-coded window names
- web build passes after the refactor

### Validation

- `pnpm test`
- `pnpm typecheck`
- `pnpm build`
- `pnpm web:build`

---

## PR 5 — Add Anthropic quota backend with cache + backoff

**Goal:** Ship Anthropic quota retrieval on the backend using the generic quota model from PR 4.

### Include

- new `src/lib/anthropic-quota.ts`
- Anthropic quota fetch using confirmed headers/endpoints
- refresh-before-fetch behavior for Anthropic OAuth tokens
- 5-minute success cache per account
- 429 exponential backoff (60s -> 15m cap)
- stale-cache return path during active backoff
- `GET /api/ui/credentials/anthropic/quota`
- persistence of refreshed tokens / derived metadata
- unit tests for quota behavior
- integration tests for route behavior
- telemetry for fetch/cache/backoff/persistence/errors

### Files likely touched

- `src/lib/anthropic-quota.ts`
- `src/lib/ui-routes.ts`
- `src/tests/anthropic-quota.test.ts`
- `src/tests/proxy.test.ts` or route-focused tests

### Explicitly do not include

- Credentials page Anthropic controls
- client-side Anthropic quota fetching

### Acceptance criteria

- Anthropic quota endpoint returns the generic `windows: []` structure
- 429 behavior is cache/backoff-safe
- refreshed Anthropic tokens persist correctly
- route is test-covered

### Validation

- `pnpm test`
- `pnpm typecheck`
- `pnpm build`

---

## PR 6 — Add Anthropic UI surface in Credentials page

**Goal:** Expose Anthropic OAuth and quota in the UI using the already-landed backend and generic quota model.

### Include

- Anthropic API helpers in `web/src/lib/api.ts`
- Anthropic browser OAuth controls in `web/src/pages/CredentialsPage.tsx`
- Anthropic quota fetch + display
- provider grouping / display updates so Anthropic accounts render cleanly
- ensure Anthropic accounts display well with no `chatgptAccountId`
- provider-neutral or provider-specific copy finalized in the UI
- manual QA across OpenAI + Factory + Anthropic flows

### Files likely touched

- `web/src/lib/api.ts`
- `web/src/pages/CredentialsPage.tsx`
- `web/src/styles.css`

### Explicitly do not include

- device-flow controls unless pre-flight research proved device flow exists
- backend protocol changes

### Acceptance criteria

- Anthropic browser OAuth can be launched from the credentials page
- Anthropic quota renders in the same generic quota UI shell
- OpenAI quota still renders correctly
- Factory UI behavior remains unchanged
- Anthropic account tiles look correct without workspace ids

### Validation

- `pnpm typecheck`
- `pnpm web:build`
- manual UI QA end to end

---

## Optional PR 7 — Frontend regression harness (only if you want stronger UI coverage)

**Goal:** Add explicit frontend test coverage if the team wants it. This is optional and should not block the feature if manual QA is acceptable.

### Include

- introduce Vitest + Testing Library and/or Playwright coverage for credentials UI
- add tests for:
  - OpenAI quota rendering
  - Anthropic quota rendering
  - Anthropic OAuth controls
  - no-`chatgptAccountId` Anthropic display cases

### Explicitly do not include

- core backend feature work

### Acceptance criteria

- UI regression coverage exists and is runnable in CI/local workflows

---

## Recommended merge order

1. **PR 1** — generic OAuth persistence parity
2. **PR 2** — Anthropic OAuth core + provider-aware refresh dispatch
3. **PR 3** — Anthropic browser OAuth backend routes
4. **PR 4** — generic quota DTO/UI refactor (OpenAI only)
5. **PR 5** — Anthropic quota backend with cache + backoff
6. **PR 6** — Anthropic UI surface
7. **PR 7** — optional frontend regression harness

---

## Suggested PR titles

- **PR 1:** `fix(db): persist generic oauth subject metadata`
- **PR 2:** `feat(auth): add anthropic oauth core and provider-aware refresh dispatch`
- **PR 3:** `feat(ui-routes): add anthropic browser oauth routes`
- **PR 4:** `refactor(quota): make quota dto and credentials ui provider-agnostic`
- **PR 5:** `feat(quota): add anthropic quota fetch with cache and backoff`
- **PR 6:** `feat(web): surface anthropic oauth and quota in credentials page`
- **PR 7:** `test(web): add credentials page regression coverage`

---

## Ship gate for the final PR in the stack

Before considering the stack done:

- [ ] Anthropic browser OAuth works end to end
- [ ] Anthropic token refresh works and does not use OpenAI refresh
- [ ] Anthropic quota route works with cache + backoff
- [ ] OpenAI and Factory still work
- [ ] SQL/file persistence are aligned for generic OAuth metadata
- [ ] `pnpm test` passes
- [ ] `pnpm typecheck` passes
- [ ] `pnpm build` passes
- [ ] `pnpm web:build` passes
- [ ] manual QA completed
