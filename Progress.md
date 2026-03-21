# Progress

## Status
Completed

## Tasks
- [x] Read existing implementation and tests
- [x] Rewrite `src/lib/anthropic-oauth.ts` to match real Anthropic OAuth protocol
- [x] Rewrite `src/tests/anthropic-oauth.test.ts` to cover new flow
- [x] TypeScript type-check passes
- [x] All 16 tests pass

## Files Changed
- `src/lib/anthropic-oauth.ts` — Complete rewrite for real Anthropic code-paste OAuth flow
- `src/tests/anthropic-oauth.test.ts` — Complete rewrite covering new flow

## Notes

### What changed in the implementation

| Aspect | Before | After |
|---|---|---|
| Auth URL | `{issuer}/oauth/authorize` | `https://claude.ai/oauth/authorize` (hardcoded) |
| Redirect URI | Our callback server | `https://console.anthropic.com/oauth/code/callback` (Anthropic's own) |
| Token endpoint | `{issuer}/oauth/token` | `{issuer}/v1/oauth/token` (note `/v1/`) |
| Token body encoding | `application/x-www-form-urlencoded` | `application/json` |
| State param | Random 32-byte base64url | PKCE verifier (reused per Anthropic convention) |
| `code` param on auth URL | absent | `"true"` |
| Code format | plain | may contain `#` — split, first=code, second=state fragment |
| Default client ID | (none) | `9d1c250a-e61b-44d9-88ed-5944d1962f5e` |
| Default scopes | `openid profile email offline_access` | `org:create_api_key user:profile user:inference` |
| Flow entry point | `startBrowserFlow(redirectBaseUrl)` + `completeBrowserFlow(state, code)` | `startCodeFlow()` + `exchangeCode(code, verifier)` |
| Browser state cache | Present (TTL map) | Removed (not needed) |
| Completion cache | Present (TTL map) | Removed (not needed) |
| In-flight dedup | Present | Removed (not needed) |
| Port resolution | Present | Removed |
| Loopback normalization | Present | Removed |
| `clientSecret` option | Present | Removed (public PKCE client only) |

### What stayed the same
- JWT claims parsing (`sub`, `email`, `plan_type`)
- Account ID derivation: `sub` → `email hash` → `timestamp` fallback
- `isTokenExpired(expiresAt, bufferMs?)` — unchanged
- Telemetry spans via `getTelemetry()`
- `AnthropicOAuthTokens` interface — unchanged
