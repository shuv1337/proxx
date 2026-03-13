# Factory.ai API Reference

Reference for workers implementing Factory.ai provider integration. Source: `/tmp/factory-openai-proxy/src/`

## Endpoints

| Model Type | Factory Endpoint URL | Format |
|---|---|---|
| Anthropic (claude-*) | `https://api.factory.ai/api/llm/a/v1/messages` | Anthropic Messages API |
| OpenAI (gpt-*) | `https://api.factory.ai/api/llm/o/v1/responses` | OpenAI Responses API |
| Common (gemini-*, glm-*, etc.) | `https://api.factory.ai/api/llm/o/v1/chat/completions` | Standard chat completions |
| Token counting | `https://api.factory.ai/api/llm/a/v1/messages/count_tokens` | Anthropic token count |

**CRITICAL:** The URL path structure is `/api/llm/{a|o}/v1/{endpoint}`, NOT `/v1/{endpoint}`. The `a` prefix is for Anthropic endpoints, `o` is for OpenAI endpoints.

## Authentication

**Priority order (all loaded into KeyPool as separate accounts):**
1. `FACTORY_API_KEY` env var — static fk- prefixed API key, used as `Bearer {key}`
2. `~/.factory/auth.v2.file` + `~/.factory/auth.v2.key` — AES-256-GCM encrypted OAuth tokens
3. `~/.factory/auth.json` — legacy plaintext JSON with `access_token` and `refresh_token`

**WorkOS OAuth flows:**

*Device flow:*
- Start: `POST https://api.workos.com/user_management/authorize/device` with body `client_id=client_01HNM792M5G5G1A2THWPXKFMXB&grant_type=urn:ietf:params:oauth:grant-type:device_code`
- Returns: `{ device_code, user_code, verification_uri, verification_uri_complete, interval, expires_in }`
- Poll: `POST https://api.workos.com/user_management/authenticate` with body `grant_type=urn:ietf:params:oauth:grant-type:device_code&device_code={code}&client_id=...`
- Returns: `{ access_token, refresh_token }` on success, error `authorization_pending` or `slow_down` or `expired_token` while waiting

*Browser flow:*
- Authorize URL: `https://api.workos.com/user_management/authorize?response_type=code&client_id=client_01HNM792M5G5G1A2THWPXKFMXB&redirect_uri={callbackUrl}&provider=authkit&state={state}`
- Callback: exchange code via `POST https://api.workos.com/user_management/authenticate` with body `grant_type=authorization_code&code={code}&client_id=...`
- Returns: `{ access_token, refresh_token, user: { id, email, ... } }`

*Token refresh:*
- Endpoint: `POST https://api.workos.com/user_management/authenticate`
- Body: `grant_type=refresh_token&refresh_token={token}&client_id=client_01HNM792M5G5G1A2THWPXKFMXB` (URL-encoded form)
- Refresh window: 30 minutes before JWT expiry
- Returns: `{ access_token, refresh_token }`

**v2 encrypted auth file format:**
- `auth.v2.file` contents: `base64(iv):base64(authTag):base64(ciphertext)`
- `auth.v2.key` contents: base64-encoded AES-256-GCM key
- Decrypted JSON: `{ access_token, refresh_token }`

## Required Headers

**All Factory requests:**
| Header | Value |
|---|---|
| `authorization` | `Bearer {token}` |
| `x-api-provider` | Model's provider (see mapping below) |
| `x-factory-client` | `"cli"` |
| `x-session-id` | UUID (generate per-request) |
| `x-assistant-message-id` | UUID (generate per-request) |
| `user-agent` | `"factory-cli/0.74.0"` |
| `connection` | `"keep-alive"` |

**Stainless SDK headers (all requests):**
| Header | Value |
|---|---|
| `x-stainless-arch` | `"x64"` |
| `x-stainless-lang` | `"js"` |
| `x-stainless-os` | `"Linux"` |
| `x-stainless-runtime` | `"node"` |
| `x-stainless-retry-count` | `"0"` |
| `x-stainless-package-version` | `"0.70.1"` |
| `x-stainless-runtime-version` | `"v24.3.0"` |

**Anthropic-specific additional headers:**
| Header | Value |
|---|---|
| `anthropic-version` | `"2023-06-01"` |
| `x-api-key` | `"placeholder"` (always literal) |
| `x-client-version` | `"0.74.0"` |
| `anthropic-beta` | `"interleaved-thinking-2025-05-14"` (when reasoning enabled) |
| `x-stainless-timeout` | `"600"` |
| `x-stainless-helper-method` | `"stream"` (streaming only) |

## Model-to-Provider Mapping (x-api-provider)

| Model Pattern | x-api-provider | Endpoint Type |
|---|---|---|
| `claude-*` | `"anthropic"` | anthropic |
| `gpt-*` | `"openai"` | openai |
| `gemini-*` | `"google"` | common |
| `glm-*` | `"fireworks"` | common |
| `kimi-*` | `"fireworks"` | common |
| `minimax-*` | `"fireworks"` | common |
| `DeepSeek-*` | `"fireworks"` | common |

## Known Quirks

1. **403 on system prompts with fk- keys:** Factory returns 403 Forbidden when the Anthropic `system` parameter is present with fk- keys. Workaround: inline system content into the first user message.

2. **x-api-key: "placeholder":** Anthropic headers must include `x-api-key: "placeholder"` — Factory requires this header to exist but uses `authorization` for actual auth.

3. **store: false:** Always add `store: false` to OpenAI Responses API requests.

4. **Content sanitization:** The word "OpenCode" should be replaced with "Assistant" in system prompts before sending to Factory.

## Streaming Event Translation

**Anthropic SSE events → OpenAI chat chunks:**
- `message_start` → `{role:"assistant"}` chunk
- `content_block_delta` → `{content: delta.text}` chunk
- `message_delta` → `{finish_reason}` chunk (map: end_turn→stop, max_tokens→length)
- `message_stop` → `data: [DONE]`

**OpenAI Responses SSE events → OpenAI chat chunks:**
- `response.created` → `{role:"assistant"}` chunk
- `response.output_text.delta` → `{content: delta}` chunk
- `response.done` → finish chunk + `[DONE]` (completed→stop, incomplete→length)
