# PLAN: Anthropic Provider OAuth + Quota Support (Revised)

## Goal

Add first-class **Anthropic** account support to proxx so the app can:

- log Anthropic users in with OAuth
- persist and refresh Anthropic OAuth credentials
- fetch and display Anthropic quota / usage data
- surface Anthropic in the credentials UI alongside existing providers
- emit telemetry for the new auth and quota flows

This remains intentionally scoped to **credential management + quota visibility**.
It does **not** change proxy runtime routing unless we later decide Anthropic credentials should power inference requests.

---

## Scope decisions up front

### In scope

- Anthropic browser OAuth
- Anthropic OAuth token refresh
- Anthropic quota / usage fetches with caching + backoff
- Credential persistence using the existing provider/account model
- UI support for Anthropic accounts and Anthropic quota visibility
- Telemetry for OAuth, refresh, quota, cache, and error paths

### Out of scope

- Proxy routing to Anthropic as an inference provider
- Anthropic device flow unless research proves it exists and we explicitly approve it
- Large cross-provider OAuth abstractions beyond tiny shared helpers
- Broad provider-id / callback-port generalization work unless Anthropic implementation proves it necessary

---

## Current codebase findings that materially affect the plan

### Existing provider patterns

Backend and refresh patterns already exist for:

- `src/lib/openai-oauth.ts`
- `src/lib/factory-oauth.ts`
- `src/lib/openai-quota.ts`
- `src/lib/ui-routes.ts`
- `src/app.ts`

UI wiring already exists in:

- `web/src/lib/api.ts`
- `web/src/pages/CredentialsPage.tsx`

### Critical constraint: refresh is provider-blind today

Current OAuth refresh wiring in `src/app.ts` routes:

- `factory` -> WorkOS refresh
- **all other OAuth providers** -> `OpenAiOAuthManager.refreshToken(...)`

That is safe for OpenAI today, but it will break once Anthropic OAuth accounts exist.

**Therefore provider-aware refresh dispatch is a required part of this plan, not a follow-up.**

### Critical constraint: callback allowlist is explicit

Unauthenticated callback routes are explicitly allowlisted in `src/app.ts`.
Today that allowlist includes:

- `/auth/callback`
- `/auth/factory/callback`

An Anthropic browser callback route will also need to be added there.

### Important constraint: SQL store does not currently persist `subject`

The file-backed credential store already supports generic OAuth metadata including:

- `email`
- `subject`
- `planType`
- `chatgptAccountId`

But the SQL-backed path currently persists:

- token
- refresh token
- expiry
- `chatgpt_account_id`
- `plan_type`
- `email`

It does **not** persist `subject` today.

Also, `src/lib/db/json-seeder.ts` currently seeds `chatgptAccountId`, `planType`, `expiresAt`, and `refreshToken`, but not `email` or `subject`.

**This plan must not pretend the generic persistence path already fully covers `subject`.**

### Important constraint: quota UI is OpenAI-specific today

The credentials UI and API currently assume:

- one quota fetch path: OpenAI
- one quota overview shape: `fiveHour` + `weekly`
- one set of labels/copy: "Codex quota", "Rolling 5h", "Weekly"

Anthropic support should not be bolted on top of those OpenAI-specific assumptions.

### Validation constraint: the current automated workflow does not cover the web app

Current project commands include:

- `pnpm test`
- `pnpm typecheck`
- `pnpm build`
- `pnpm web:build`

But the main `test` script only exercises backend tests. There is no existing dedicated frontend component-test harness.

**The plan must include `pnpm web:build` and must not imply UI tests already exist unless we add that tooling.**

---

## Recommended design

### 1) Keep Anthropic provider-specific at the service layer

Add dedicated modules first:

- `src/lib/anthropic-oauth.ts`
- `src/lib/anthropic-quota.ts`

Do **not** try to force OpenAI, Factory, and Anthropic into one large generic OAuth implementation.
The real shared surface is likely limited to things like:

- PKCE generation
- state generation / pruning
- JWT parsing helpers

Anything beyond that should be earned by duplication, not assumed up front.

### 2) Treat provider-aware refresh as first-class architecture work

Anthropic OAuth support is not complete unless these paths are updated:

- manual refresh flow in `src/app.ts`
- background refresh flow in `src/app.ts`
- any helper that currently assumes "non-Factory OAuth means OpenAI"

Required dispatch shape:

- `factory` -> WorkOS refresh
- `openai` -> OpenAI refresh
- `anthropic` -> Anthropic refresh
- unknown OAuth provider -> log + skip, not OpenAI by default

### 3) Make quota DTOs provider-agnostic before adding Anthropic UI

Do not extend the existing OpenAI-only `fiveHour` / `weekly` shape.
Instead, normalize provider quota responses into a generic UI-ready structure.

Recommended normalized shape:

```ts
interface CredentialQuotaWindowSummary {
  readonly key: string;
  readonly label: string;
  readonly usedPercent: number | null;
  readonly remainingPercent: number | null;
  readonly resetsAt: string | null;
  readonly resetAfterSeconds: number | null;
}

interface CredentialQuotaAccountSummary {
  readonly providerId: string;
  readonly accountId: string;
  readonly displayName: string;
  readonly email?: string;
  readonly planType?: string;
  readonly status: "ok" | "error";
  readonly fetchedAt: string;
  readonly stale?: boolean;
  readonly backoffUntil?: string;
  readonly windows: readonly CredentialQuotaWindowSummary[];
  readonly error?: string;
}
```

OpenAI can then map to:

- `Rolling 5h`
- `Weekly`

Anthropic can map to whatever the real API exposes, such as:

- `Daily`
- `Monthly`
- or any other provider-specific windows

### 4) Fix the generic persistence contract explicitly

Because the file store already models `subject`, but the SQL path drops it, this plan will include a **small generic OAuth persistence correction**.

That means:

- add `subject` to the SQL accounts table
- thread it through SQL upsert/select/list paths
- update JSON seeding to preserve `email` and `subject`

This is not Anthropic-specific schema churn; it corrects an existing mismatch between the file store contract and the SQL store contract.

### 5) Keep config additions minimal on first pass

Add only the config needed to implement Anthropic cleanly:

- issuer
- client id
- scopes
- beta header override for the usage endpoint

Do **not** add a new provider-id config or callback-port config unless implementation proves we need to generalize those patterns across providers.

---

## Implementation plan

## Phase 0 — Research gate: confirm Anthropic protocol details before coding

Before writing implementation code, confirm the actual Anthropic OAuth and usage details from the reference implementation and/or live docs.

- [ ] Confirm the authorization endpoint.
- [ ] Confirm the token exchange endpoint.
- [ ] Confirm refresh-token support and request format.
- [ ] Confirm required scopes for quota access, especially whether `user:profile` is required.
- [ ] Confirm the usage / quota endpoint URL.
- [ ] Confirm required request headers, including:
  - `Authorization: Bearer <access_token>`
  - `anthropic-version`
  - `anthropic-beta`
- [ ] Confirm whether the `anthropic-beta` header value must be configurable.
- [ ] Confirm whether Anthropic device flow exists.
- [ ] If device flow does **not** exist, document browser-only as a hard scope boundary.
- [ ] Capture the validated findings in code comments or test fixtures so the implementation is not based on memory.

**Exit criteria for Phase 0:**

- we know the real OAuth endpoints
- we know the real scopes
- we know the real quota endpoint and headers
- we have explicit confirmation on browser-only vs device-flow support

---

## Phase 1 — Add Anthropic service-layer primitives

### 1.1 Build an Anthropic OAuth module

Add `src/lib/anthropic-oauth.ts`.

Responsibilities:

- [ ] browser OAuth start
- [ ] browser callback / code exchange completion
- [ ] refresh-token exchange
- [ ] stable account identity derivation on initial sign-in
- [ ] extraction of `email`, `subject`, `planType` when available
- [ ] provider-safe error handling
- [ ] telemetry spans/logs for start, exchange, refresh, and failure paths

Implementation notes:

- [ ] Default to **browser-only** unless Phase 0 proves device flow exists.
- [ ] Do not add Anthropic to `DeviceAuthState` or UI device-flow controls unless device flow is confirmed.
- [ ] Keep account identity derivation deterministic on initial sign-in.
- [ ] During refresh, preserve the existing stored `accountId` unless the provider contract clearly requires re-derivation.
- [ ] If token claims are JWT-based, extract metadata from claims; otherwise support profile-response-derived metadata if necessary.

Reference files:

- `src/lib/openai-oauth.ts`
- `src/lib/factory-oauth.ts`
- `src/app.ts`
- `src/lib/ui-routes.ts`

### 1.2 Build an Anthropic quota module

Add `src/lib/anthropic-quota.ts`.

Responsibilities:

- [ ] fetch Anthropic quota / usage data
- [ ] refresh expired/expiring Anthropic tokens before quota fetches
- [ ] normalize provider-specific response data into the shared quota DTO shape
- [ ] persist refreshed tokens + derived metadata back to the credential store
- [ ] emit telemetry for fetch, refresh, caching, backoff, persistence, and errors

Rate-limit hardening is mandatory.

Implement:

- [ ] per-account success caching for at least 5 minutes
- [ ] exponential backoff on 429s starting at 60s, capped at 15 minutes
- [ ] stale-cache return behavior when backoff is active
- [ ] a `last updated` / staleness indicator in the normalized response
- [ ] no polling more frequently than once per 5 minutes per account

Implementation notes:

- [ ] Treat `user:profile` or similar scope failures as explicit user-facing errors.
- [ ] Do not force Anthropic usage into OpenAI window names.
- [ ] Make the `anthropic-beta` header value configurable.
- [ ] Keep caching/backoff state in a form that is observable and testable.

Reference files:

- `src/lib/openai-quota.ts`
- `src/lib/credential-store.ts`
- `src/lib/runtime-credential-store.ts`

### 1.3 Extract tiny shared helpers only if clearly useful

Optional only.

- [ ] If duplication becomes real, extract small helpers into `src/lib/oauth-common.ts`.
- [ ] Limit extraction to provider-agnostic helpers such as PKCE/state/JWT parsing.
- [ ] Do not extract token exchange or identity logic that is still provider-specific.

---

## Phase 2 — Backend integration and refresh safety

### 2.1 Add Anthropic config to `src/lib/config.ts`

Add only the minimal config needed for first-pass Anthropic support.

Recommended additions to `ProxyConfig` and env parsing:

- [ ] `anthropicOauthIssuer` / `ANTHROPIC_OAUTH_ISSUER`
- [ ] `anthropicOauthClientId` / `ANTHROPIC_OAUTH_CLIENT_ID`
- [ ] `anthropicOauthScopes` / `ANTHROPIC_OAUTH_SCOPES`
- [ ] `anthropicOauthBetaHeader` / `ANTHROPIC_OAUTH_BETA_HEADER`

Do **not** add these unless implementation proves they are needed:

- `ANTHROPIC_PROVIDER_ID`
- `ANTHROPIC_OAUTH_CALLBACK_PORT`

The Anthropic provider id should remain the literal provider id used throughout the app (`"anthropic"`) unless later work generalizes provider identifiers.

### 2.2 Make refresh dispatch provider-aware in `src/app.ts`

This is a required implementation phase.

- [ ] Instantiate an Anthropic OAuth manager in `src/app.ts`.
- [ ] Update token refresh dispatch so Anthropic credentials do **not** use OpenAI refresh.
- [ ] Preserve existing Factory refresh behavior.
- [ ] Keep background refresh generic, but route each credential to the correct provider-specific refresh implementation.
- [ ] For unsupported OAuth providers, log + skip rather than defaulting to OpenAI.

Recommended refresh dispatch behavior:

- `factory` -> `refreshFactoryAccount(...)`
- `config.openaiProviderId` -> OpenAI refresh manager
- `anthropic` -> Anthropic refresh manager
- anything else -> unsupported OAuth provider log entry

Also update any manual refresh path that should support Anthropic.

- [ ] Decide whether to add `POST /api/ui/credentials/anthropic/oauth/refresh` for parity/testing.
- [ ] If added, wire it through the same provider-aware refresh dispatcher rather than adding Anthropic-only logic in isolation.

### 2.3 Add Anthropic OAuth routes in `src/lib/ui-routes.ts`

Add Anthropic browser OAuth routes.

Required routes:

- [ ] `POST /api/ui/credentials/anthropic/oauth/browser/start`
- [ ] `GET /auth/anthropic/callback`

Callback route guidance:

- [ ] Use a short, top-level callback path.
- [ ] Match current browser callback style rather than nesting under `/api/`.
- [ ] Persist the Anthropic OAuth account through the shared credential store.
- [ ] Leave `chatgptAccountId` undefined for Anthropic accounts.

If and only if Phase 0 proves Anthropic device flow exists, add:

- [ ] `POST /api/ui/credentials/anthropic/oauth/device/start`
- [ ] `POST /api/ui/credentials/anthropic/oauth/device/poll`

Otherwise explicitly omit device-flow routes.

### 2.4 Add Anthropic quota route(s)

Add quota retrieval for Anthropic.

Required route:

- [ ] `GET /api/ui/credentials/anthropic/quota`

Route behavior:

- [ ] call `src/lib/anthropic-quota.ts`
- [ ] return the normalized generic quota DTO
- [ ] support optional `accountId` filtering
- [ ] return stale/backoff metadata when applicable

### 2.5 Allow Anthropic callback unauthenticated in `src/app.ts`

Add the new callback route to the explicit unauthenticated route allowlist.

- [ ] include `/auth/anthropic/callback`
- [ ] keep callback allowlisting tightly scoped to auth completion only

This is required for the browser OAuth flow to work.

---

## Phase 3 — Persistence alignment and storage updates

### 3.1 Continue using the shared OAuth account model

Anthropic accounts should still use the existing generic provider/account structure.

Use the shared OAuth fields for:

- [ ] access token
- [ ] refresh token
- [ ] expiry
- [ ] email
- [ ] subject
- [ ] plan type when available

Anthropic-specific note:

- [ ] `chatgptAccountId` remains undefined for Anthropic accounts
- [ ] all display and sorting logic must degrade gracefully when that field is absent

### 3.2 Add a small SQL migration for `subject`

Because the SQL path currently drops `subject`, include a small migration rather than pretending that field is already stored.

Implementation tasks:

- [ ] bump schema version
- [ ] add `subject` column to `accounts`
- [ ] update `INSERT_ACCOUNT`
- [ ] update `SELECT_ALL_ACCOUNTS` / `SELECT_ACCOUNTS_BY_PROVIDER`
- [ ] update `AccountRow`
- [ ] update `toProviderCredential(...)`
- [ ] update `listProviders(...)`
- [ ] update SQL `upsertOAuthAccount(...)` to actually persist `subject`

### 3.3 Keep file, SQL, and seed paths aligned

Update persistence code so generic OAuth metadata is not lost depending on storage backend.

- [ ] keep file-store behavior unchanged
- [ ] make SQL-store behavior match the generic file-store contract
- [ ] update `src/lib/db/json-seeder.ts` to preserve `email` and `subject` when seeding OAuth accounts
- [ ] confirm `RuntimeCredentialStore` remains symmetric across file + SQL paths

### 3.4 Verify Anthropic display behavior without `chatgptAccountId`

Required checks:

- [ ] account list display name fallback still works
- [ ] sorting still works
- [ ] provider chips / badges remain valid
- [ ] compact identifiers do not assume OpenAI workspace ids

Reference files:

- `src/lib/credential-store.ts`
- `src/lib/runtime-credential-store.ts`
- `src/lib/db/sql-credential-store.ts`
- `src/lib/db/schema.ts`
- `src/lib/db/json-seeder.ts`
- `web/src/pages/CredentialsPage.tsx`

---

## Phase 4 — Provider-agnostic quota API and UI refactor

### 4.1 Refactor quota DTOs in `web/src/lib/api.ts`

Before adding Anthropic UI rendering, refactor the client types away from OpenAI-specific quota windows.

- [ ] replace `fiveHour` / `weekly` DTO assumptions with `windows: []`
- [ ] preserve `providerId`, `accountId`, `displayName`, `fetchedAt`, `status`, and `error`
- [ ] add optional `stale` / `backoffUntil` support if the backend returns it

### 4.2 Update `CredentialsPage.tsx` to be quota-provider-aware

Current page behavior assumes:

- a single OpenAI quota fetch
- OpenAI copy ("Codex quota")
- OpenAI labels ("Rolling 5h", "Weekly")

Refactor it so Anthropic fits naturally.

Required changes:

- [ ] fetch quota data for all supported quota providers we want visible in the page
- [ ] merge quota results by `providerId + accountId`
- [ ] render provider-specific card titles or a generic `Usage / quota` title
- [ ] render window labels from data rather than hard-coded strings
- [ ] keep OpenAI behavior intact after the refactor
- [ ] render Anthropic account quota rows using the same generic quota-card shell

Recommended copy changes:

- replace "Codex quota" with either:
  - provider-specific labels (`OpenAI quota`, `Anthropic quota`), or
  - a generic label (`Usage / quota`)
- replace "Refresh Codex quotas" with a provider-neutral label such as `Refresh OAuth quotas`

### 4.3 Add Anthropic OAuth controls to the credentials page

- [ ] add an `Anthropic (Claude)` OAuth section
- [ ] wire browser flow start button
- [ ] only add device-flow buttons if Phase 0 explicitly approves device flow
- [ ] do not extend `DeviceAuthState` unless device flow is real

### 4.4 Update provider rendering logic

- [ ] ensure `shouldShowQuota` is not OpenAI-only
- [ ] ensure Anthropic accounts appear in provider grouping, plan grouping, and domain grouping
- [ ] ensure details panels do not reference OpenAI workspace language for Anthropic accounts

Reference files:

- `web/src/lib/api.ts`
- `web/src/pages/CredentialsPage.tsx`
- `web/src/styles.css`

---

## Phase 5 — Telemetry and observability

Telemetry is a required deliverable, not polish.

### 5.1 OAuth telemetry

Add structured logs and OTEL spans for:

- [ ] Anthropic browser OAuth start
- [ ] Anthropic callback success
- [ ] Anthropic callback failure
- [ ] Anthropic token refresh success/failure

Attributes should include stable identifiers only:

- provider id
- stored account id
- response status / error class
- duration

Never log raw access tokens or refresh tokens.

### 5.2 Quota telemetry

Add structured logs and OTEL spans for:

- [ ] quota fetch start/end
- [ ] HTTP status
- [ ] cache hit/miss
- [ ] stale-cache return
- [ ] backoff applied / active
- [ ] refresh-before-fetch success/failure
- [ ] persistence write success/failure

Use both:

- [ ] Fastify/app structured logs for local debugging
- [ ] `getTelemetry()` spans/logs/metrics for OTEL visibility

### 5.3 Local telemetry validation

- [ ] confirm spans/logs appear in the local OTEL pipeline
- [ ] confirm no secrets are emitted
- [ ] confirm provider/account attribution is present

Reference files:

- `src/lib/telemetry/otel.ts`
- `src/app.ts`
- `src/lib/ui-routes.ts`
- `src/lib/openai-quota.ts`

---

## Phase 6 — Tests

### 6.1 OAuth unit tests

Add `src/tests/anthropic-oauth.test.ts`.

Cover:

- [ ] browser auth start URL generation
- [ ] callback success path
- [ ] callback failure path
- [ ] stable account identity derivation on initial sign-in
- [ ] refresh-token exchange success/failure
- [ ] state expiry / invalid-state handling
- [ ] browser-only behavior if device flow is intentionally unsupported

### 6.2 Quota unit tests

Add `src/tests/anthropic-quota.test.ts`.

Cover:

- [ ] successful quota fetch
- [ ] normalized generic window parsing
- [ ] missing-scope / profile-scope failures
- [ ] refresh-before-fetch behavior
- [ ] persistence of refreshed tokens / metadata
- [ ] caching within TTL
- [ ] 429 backoff behavior
- [ ] stale cache returned during backoff
- [ ] recovery after backoff expires

### 6.3 Refresh-dispatch tests

Add coverage for the provider-aware refresh dispatcher in `src/app.ts`.

Required cases:

- [ ] Factory OAuth accounts still use WorkOS refresh
- [ ] OpenAI OAuth accounts still use OpenAI refresh
- [ ] Anthropic OAuth accounts use Anthropic refresh
- [ ] unsupported OAuth provider ids do not fall through to OpenAI refresh

This is the highest-risk regression area introduced by this feature.

### 6.4 Route integration tests

Extend `src/tests/proxy.test.ts` or add focused route tests.

Cover:

- [ ] `POST /api/ui/credentials/anthropic/oauth/browser/start`
- [ ] `GET /auth/anthropic/callback`
- [ ] Anthropic credential persistence after callback
- [ ] callback allowlist behavior for `/auth/anthropic/callback`
- [ ] `GET /api/ui/credentials/anthropic/quota`
- [ ] no regression in existing OpenAI / Factory routes

### 6.5 Persistence tests

Add tests for the generic OAuth persistence alignment work:

- [ ] SQL upsert/select preserving `subject`
- [ ] `listProviders(...)` returning `subject`
- [ ] JSON seeder preserving `email` + `subject`

### 6.6 UI test posture

The repo does **not** currently have a dedicated frontend unit-test harness.
Do not claim UI component tests unless we add one.

For this plan:

- [ ] minimum automated web validation is `pnpm web:build`
- [ ] manual UI QA is required
- [ ] if stronger UI regression coverage is desired, explicitly add a frontend test harness (Vitest + Testing Library and/or Playwright) as separate scope

---

## Phase 7 — Validation checklist

### Automated validation

- [ ] `pnpm test`
- [ ] `pnpm typecheck`
- [ ] `pnpm build`
- [ ] `pnpm web:build`

### Manual validation

- [ ] Start the app locally and open the credentials UI.
- [ ] Run Anthropic browser OAuth end to end.
- [ ] Confirm the Anthropic account persists and reappears after reload.
- [ ] Confirm quota data loads for Anthropic accounts.
- [ ] Force an expired/expiring token and confirm Anthropic refresh works.
- [ ] Confirm OpenAI refresh still works.
- [ ] Confirm Factory refresh still works.
- [ ] Trigger or simulate 429 behavior and confirm stale cached quota is shown instead of aggressive retrying.
- [ ] Confirm the new callback route works without normal proxy auth.
- [ ] Confirm Anthropic accounts render cleanly without `chatgptAccountId`.
- [ ] Confirm telemetry is emitted and contains no secrets.

---

## Implementation order

1. **Phase 0 research gate** — confirm real Anthropic protocol details.
2. **Phase 1 service-layer modules** — implement Anthropic OAuth + quota.
3. **Phase 2 refresh safety + routes** — add provider-aware refresh dispatch, routes, and callback allowlist.
4. **Phase 3 persistence alignment** — add the small `subject` migration and keep seed/store paths consistent.
5. **Phase 4 UI refactor + Anthropic UI** — make quota rendering provider-agnostic, then expose Anthropic.
6. **Phase 5 telemetry** — instrument the new code paths.
7. **Phase 6/7 tests and validation** — run backend + web validation and complete manual QA.

---

## Config additions needed

Add these to `src/lib/config.ts` and `ProxyConfig`:

- `ANTHROPIC_OAUTH_ISSUER`
- `ANTHROPIC_OAUTH_CLIENT_ID`
- `ANTHROPIC_OAUTH_SCOPES`
- `ANTHROPIC_OAUTH_BETA_HEADER`

Suggested runtime names in config:

- `anthropicOauthIssuer`
- `anthropicOauthClientId`
- `anthropicOauthScopes`
- `anthropicOauthBetaHeader`

Do not add provider-id or callback-port config in this change unless implementation proves the pattern needs to be generalized.

---

## Explicit non-goals

- No inference routing changes for Anthropic in this plan.
- No Anthropic device-flow support unless Phase 0 proves it exists and we separately approve it.
- No large "universal OAuth manager" rewrite.
- No broad provider identifier / callback port generalization unless the Anthropic work demonstrates clear need.

---

## Open questions / decision gates

### 1) Does Anthropic expose only browser PKCE, or is there a real device flow?

**Default assumption for this plan:** browser-only.
If research says otherwise, device flow must be explicitly added back into scope.

### 2) What exact windows does the Anthropic usage endpoint expose?

Do not assume daily/monthly unless the real API says so.
The UI must render labels returned by the normalized data.

### 3) Do we need a manual Anthropic refresh endpoint for QA parity?

Not strictly required if background refresh + quota-triggered refresh are sufficient, but worth deciding during backend integration.

### 4) Does the quota/usage endpoint return plan metadata directly?

If yes, persist it.
If not, only derive/store what the provider actually exposes.
