# Implementation-Ready Checklist: Anthropic OAuth + Quota

Use this as the execution checklist for `PLAN-anthropic-provider-oauth-quota.md`.

## 0. Research gate

- [ ] Confirm Anthropic OAuth authorize endpoint
- [ ] Confirm Anthropic OAuth token endpoint
- [ ] Confirm Anthropic refresh-token exchange format
- [ ] Confirm required scopes for quota access
- [ ] Confirm quota / usage endpoint URL
- [ ] Confirm required headers:
  - [ ] `Authorization: Bearer <token>`
  - [ ] `anthropic-version`
  - [ ] `anthropic-beta`
- [ ] Confirm whether Anthropic device flow exists
- [ ] If no device flow: lock scope to browser-only and do not add device-flow UI/types/routes

## 1. Config

Files:
- `src/lib/config.ts`

- [ ] Add `anthropicOauthIssuer` / `ANTHROPIC_OAUTH_ISSUER`
- [ ] Add `anthropicOauthClientId` / `ANTHROPIC_OAUTH_CLIENT_ID`
- [ ] Add `anthropicOauthScopes` / `ANTHROPIC_OAUTH_SCOPES`
- [ ] Add `anthropicOauthBetaHeader` / `ANTHROPIC_OAUTH_BETA_HEADER`
- [ ] Keep provider id literal as `anthropic` unless broader config generalization is required

## 2. Anthropic OAuth module

Files:
- `src/lib/anthropic-oauth.ts`
- reference: `src/lib/openai-oauth.ts`
- reference: `src/lib/factory-oauth.ts`

- [ ] Implement browser OAuth start
- [ ] Implement browser callback code exchange
- [ ] Implement refresh-token exchange
- [ ] Derive stable initial account identity
- [ ] Extract `email`, `subject`, `planType` when available
- [ ] Add clear errors for invalid state / missing code / token exchange failure / scope issues
- [ ] Add telemetry for start, callback, refresh, failure
- [ ] Add unit tests in `src/tests/anthropic-oauth.test.ts`

## 3. Anthropic quota module

Files:
- `src/lib/anthropic-quota.ts`
- reference: `src/lib/openai-quota.ts`

- [ ] Implement quota fetch
- [ ] Refresh token before fetch when needed
- [ ] Normalize response into generic quota DTO with `windows: []`
- [ ] Add 5-minute success cache per account
- [ ] Add 429 exponential backoff (60s -> 15m cap)
- [ ] Return stale cached data during backoff when available
- [ ] Persist refreshed token + derived metadata
- [ ] Add telemetry for fetch, cache, backoff, refresh, persistence, errors
- [ ] Add unit tests in `src/tests/anthropic-quota.test.ts`

## 4. Provider-aware refresh integration

Files:
- `src/app.ts`

- [ ] Instantiate Anthropic OAuth manager in app bootstrap
- [ ] Update OAuth refresh dispatch:
  - [ ] `factory` -> existing Factory refresh
  - [ ] `openai` -> existing OpenAI refresh
  - [ ] `anthropic` -> Anthropic refresh
  - [ ] unknown OAuth provider -> log + skip
- [ ] Ensure background refresh uses provider-aware dispatch
- [ ] Ensure manual refresh flow does not default Anthropic to OpenAI refresh
- [ ] Add tests covering refresh dispatch behavior

## 5. Backend routes

Files:
- `src/lib/ui-routes.ts`
- `src/app.ts`

- [ ] Add `POST /api/ui/credentials/anthropic/oauth/browser/start`
- [ ] Add `GET /auth/anthropic/callback`
- [ ] Add `GET /api/ui/credentials/anthropic/quota`
- [ ] Optionally add manual refresh route if useful for QA parity
- [ ] Add `/auth/anthropic/callback` to unauthenticated callback allowlist in `src/app.ts`
- [ ] Persist Anthropic OAuth accounts through shared credential store
- [ ] Leave `chatgptAccountId` undefined for Anthropic accounts
- [ ] Add route/integration coverage in `src/tests/proxy.test.ts` or focused tests

## 6. Persistence alignment

Files:
- `src/lib/db/schema.ts`
- `src/lib/db/sql-credential-store.ts`
- `src/lib/credential-store.ts`
- `src/lib/runtime-credential-store.ts`
- `src/lib/db/json-seeder.ts`

- [ ] Add `subject` column to SQL `accounts` table
- [ ] Bump schema version and migration list
- [ ] Update SQL insert/upsert/select types and queries to include `subject`
- [ ] Update SQL `upsertOAuthAccount(...)` to persist `subject`
- [ ] Update SQL provider/account listing to return `subject`
- [ ] Update JSON seeder to preserve `email` and `subject`
- [ ] Verify file store / SQL store parity for OAuth metadata
- [ ] Add persistence tests for `subject`, `email`, and seeding behavior

## 7. Quota API + UI refactor

Files:
- `web/src/lib/api.ts`
- `web/src/pages/CredentialsPage.tsx`
- `web/src/styles.css`

- [ ] Replace OpenAI-specific quota DTOs (`fiveHour`, `weekly`) with generic `windows: []`
- [ ] Support stale/backoff metadata in client types
- [ ] Refactor credentials page quota rendering to use labels from data
- [ ] Replace OpenAI-only copy:
  - [ ] `Codex quota`
  - [ ] `Refresh Codex quotas`
- [ ] Add Anthropic OAuth section to credentials page
- [ ] Add Anthropic quota display to credentials page
- [ ] Keep OpenAI rendering working after the generic refactor
- [ ] Keep Factory behavior unchanged
- [ ] Only extend `DeviceAuthState` and add device-flow controls if research confirms device flow exists
- [ ] Verify Anthropic accounts render cleanly without `chatgptAccountId`

## 8. Telemetry

Files:
- `src/lib/telemetry/otel.ts`
- `src/app.ts`
- `src/lib/ui-routes.ts`
- `src/lib/anthropic-oauth.ts`
- `src/lib/anthropic-quota.ts`

- [ ] Add spans/logs for OAuth start/callback/refresh
- [ ] Add spans/logs for quota fetch/cache/backoff/persistence
- [ ] Include provider id + account id attribution
- [ ] Exclude raw access/refresh tokens from logs and telemetry
- [ ] Validate telemetry locally end to end

## 9. Automated validation

- [ ] `pnpm test`
- [ ] `pnpm typecheck`
- [ ] `pnpm build`
- [ ] `pnpm web:build`

## 10. Manual QA

- [ ] Complete Anthropic browser OAuth end to end
- [ ] Confirm Anthropic account persists after reload
- [ ] Confirm Anthropic quota loads in UI
- [ ] Confirm Anthropic token refresh works
- [ ] Confirm OpenAI refresh still works
- [ ] Confirm Factory refresh still works
- [ ] Confirm callback route works unauthenticated
- [ ] Confirm 429/backoff returns stale cached data instead of hammering endpoint
- [ ] Confirm Anthropic accounts display correctly with no `chatgptAccountId`
- [ ] Confirm telemetry appears with no secrets

## Ship criteria

- [ ] Anthropic browser OAuth works
- [ ] Anthropic quota endpoint works with cache + backoff
- [ ] Refresh dispatch is provider-aware
- [ ] SQL/file persistence are aligned for generic OAuth metadata
- [ ] UI renders OpenAI + Anthropic quota cleanly from generic quota data
- [ ] Backend tests pass
- [ ] Web build passes
- [ ] Manual QA completed
