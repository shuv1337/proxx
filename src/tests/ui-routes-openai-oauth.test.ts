import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createApp } from "../app.js";
import type { ProxyConfig } from "../lib/config.js";

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null;
}

function makeJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${header}.${body}.sig`;
}

async function withUiApp(
  keysPayload: unknown,
  fn: (ctx: { readonly app: Awaited<ReturnType<typeof createApp>>; readonly tempDir: string }) => Promise<void>,
): Promise<void> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "open-hax-ui-oauth-test-"));
  const keysPath = path.join(tempDir, "keys.json");
  const modelsPath = path.join(tempDir, "models.json");
  const requestLogsPath = path.join(tempDir, "request-logs.json");
  const promptAffinityPath = path.join(tempDir, "prompt-affinity.json");
  const settingsPath = path.join(tempDir, "proxy-settings.json");

  await writeFile(keysPath, JSON.stringify(keysPayload, null, 2), "utf8");
  await writeFile(modelsPath, JSON.stringify({ models: [] }, null, 2), "utf8");

  const config: ProxyConfig = {
    host: "127.0.0.1",
    port: 0,
    upstreamProviderId: "vivgrid",
    upstreamFallbackProviderIds: [],
    disabledProviderIds: [],
    upstreamProviderBaseUrls: {
      vivgrid: "http://example.invalid",
      "ollama-cloud": "http://example.invalid",
      openai: "http://example.invalid",
      openrouter: "http://example.invalid",
      requesty: "http://example.invalid",
      gemini: "http://example.invalid",
    },
    upstreamBaseUrl: "http://example.invalid",
    openaiProviderId: "openai",
    openaiBaseUrl: "http://example.invalid",
    openaiApiBaseUrl: "http://example.invalid",
    openaiImagesUpstreamMode: "auto",
    ollamaBaseUrl: "http://example.invalid",
    localOllamaEnabled: true,
    localOllamaModelPatterns: [":2b", ":3b", ":4b", ":7b", ":8b", "mini", "small"],
    chatCompletionsPath: "/v1/chat/completions",
    openaiChatCompletionsPath: "/v1/chat/completions",
    messagesPath: "/v1/messages",
    messagesModelPrefixes: ["claude-"],
    messagesInterleavedThinkingBeta: "interleaved-thinking-2025-05-14",
    responsesPath: "/v1/responses",
    openaiResponsesPath: "/v1/responses",
    openaiImagesGenerationsPaths: ["/v1/images/generations", "/images/generations", "/codex/images/generations"],
    imageCostUsdDefault: 0,
    imageCostUsdByProvider: {},
    imagesGenerationsPath: "/v1/images/generations",
    responsesModelPrefixes: ["gpt-"],
    ollamaChatPath: "/api/chat",
    ollamaV1ChatPath: "/v1/chat/completions",
    factoryModelPrefixes: ["factory/", "factory:"],
    openaiModelPrefixes: ["openai/", "openai:"],
    ollamaModelPrefixes: ["ollama/", "ollama:"],
    keysFilePath: keysPath,
    modelsFilePath: modelsPath,
    requestLogsFilePath: requestLogsPath,
    requestLogsMaxEntries: 100000,
    promptAffinityFilePath: promptAffinityPath,
    settingsFilePath: settingsPath,
    keyReloadMs: 50,
    keyCooldownMs: 10000,
    requestTimeoutMs: 2000,
    streamBootstrapTimeoutMs: 2000,
    upstreamTransientRetryCount: 2,
    upstreamTransientRetryBackoffMs: 1,
    proxyAuthToken: undefined,
    allowUnauthenticated: true,
    databaseUrl: undefined,
    githubOAuthClientId: undefined,
    githubOAuthClientSecret: undefined,
    githubOAuthCallbackPath: "/auth/github/callback",
    githubAllowedUsers: [],
    sessionSecret: "test-session-token", // pragma: allowlist secret
    openaiOauthScopes: "openid profile email offline_access",
    openaiOauthClientId: "app_EMoamEEZ73f0CkXaXp7hrann",
    openaiOauthIssuer: "https://auth.openai.com",
    anthropicOauthIssuer: "https://platform.claude.com",
    anthropicOauthClientId: "",
    anthropicOauthScopes: "org:create_api_key user:profile user:inference user:sessions:claude_code user:mcp_servers user:file_upload",
    anthropicOauthBetaHeader: "",
    proxyTokenPepper: "test-proxy-token-pepper",
    oauthRefreshMaxConcurrency: 32,
    oauthRefreshBackgroundIntervalMs: 15_000,
    oauthRefreshProactiveWindowMs: 30 * 60_000,
  };

  const app = await createApp(config);
  try {
    await fn({ app, tempDir });
  } finally {
    await app.close();
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function withPatchedFetch(
  handler: (input: Parameters<typeof fetch>[0], init: Parameters<typeof fetch>[1], originalFetch: typeof fetch) => Promise<Response | undefined>,
  fn: () => Promise<void>,
): Promise<void> {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input, init) => {
    const response = await handler(input, init, originalFetch);
    if (response) {
      return response;
    }
    return originalFetch(input, init);
  }) as typeof fetch;

  try {
    await fn();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test("OpenAI browser OAuth callback persists email metadata", async () => {
  const accessToken = makeJwt({
    "https://api.openai.com/auth": {
      chatgpt_account_id: "workspace-browser",
      chatgpt_plan_type: "pro",
    },
    "https://api.openai.com/profile": {
      email: "browser@example.com",
    },
    sub: "user-browser",
  });

  await withPatchedFetch(
    async (input) => {
      if (String(input) !== "https://auth.openai.com/oauth/token") {
        return undefined;
      }

      return new Response(JSON.stringify({
        access_token: accessToken,
        refresh_token: "refresh-browser",
        expires_in: 3600,
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
    async () => {
      await withUiApp({ providers: {} }, async ({ app, tempDir }) => {
        const startResponse = await app.inject({
          method: "POST",
          url: "/api/ui/credentials/openai/oauth/browser/start",
          payload: { redirectBaseUrl: "http://127.0.0.1:8789" },
        });

        assert.equal(startResponse.statusCode, 200);
        const startPayload: unknown = startResponse.json();
        assert.ok(isRecord(startPayload));
        assert.equal(typeof startPayload.state, "string");

        const callbackResponse = await app.inject({
          method: "GET",
          url: `/auth/callback?state=${encodeURIComponent(String(startPayload.state))}&code=browser-code`,
        });

        assert.equal(callbackResponse.statusCode, 200);

        const keysJson = await readFile(path.join(tempDir, "keys.json"), "utf8");
        const parsedKeys: unknown = JSON.parse(keysJson);
        assert.ok(isRecord(parsedKeys));
        assert.ok(isRecord(parsedKeys.providers));
        assert.ok(isRecord(parsedKeys.providers.openai));
        assert.ok(Array.isArray(parsedKeys.providers.openai.accounts));
        assert.ok(isRecord(parsedKeys.providers.openai.accounts[0]));
        assert.equal(parsedKeys.providers.openai.accounts[0].email, "browser@example.com");
        assert.equal(parsedKeys.providers.openai.accounts[0].subject, "user-browser");
        assert.equal(parsedKeys.providers.openai.accounts[0].plan_type, "pro");
        assert.equal(parsedKeys.providers.openai.accounts[0].chatgpt_account_id, "workspace-browser");
      });
    },
  );
});

test("OpenAI device OAuth polling persists email metadata", async () => {
  const accessToken = makeJwt({
    "https://api.openai.com/auth": {
      chatgpt_account_id: "workspace-device",
      chatgpt_plan_type: "plus",
    },
    "https://api.openai.com/profile": {
      email: "device@example.com",
    },
    sub: "user-device",
  });

  await withPatchedFetch(
    async (input) => {
      const url = String(input);
      if (url === "https://auth.openai.com/api/accounts/deviceauth/usercode") {
        return new Response(JSON.stringify({
          device_auth_id: "device-auth-1",
          user_code: "USER-CODE",
          interval: "5",
        }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }

      if (url === "https://auth.openai.com/api/accounts/deviceauth/token") {
        return new Response(JSON.stringify({
          authorization_code: "device-code-authz",
          code_verifier: "device-verifier",
        }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }

      if (url === "https://auth.openai.com/oauth/token") {
        return new Response(JSON.stringify({
          access_token: accessToken,
          refresh_token: "refresh-device",
          expires_in: 3600,
        }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }

      return undefined;
    },
    async () => {
      await withUiApp({ providers: {} }, async ({ app, tempDir }) => {
        const startResponse = await app.inject({
          method: "POST",
          url: "/api/ui/credentials/openai/oauth/device/start",
        });

        assert.equal(startResponse.statusCode, 200);
        const startPayload: unknown = startResponse.json();
        assert.ok(isRecord(startPayload));
        assert.equal(startPayload.deviceAuthId, "device-auth-1");
        assert.equal(startPayload.userCode, "USER-CODE");

        const pollResponse = await app.inject({
          method: "POST",
          url: "/api/ui/credentials/openai/oauth/device/poll",
          payload: {
            deviceAuthId: "device-auth-1",
            userCode: "USER-CODE",
          },
        });

        assert.equal(pollResponse.statusCode, 200);
        const pollPayload: unknown = pollResponse.json();
        assert.ok(isRecord(pollPayload));
        assert.equal(pollPayload.state, "authorized");

        const keysJson = await readFile(path.join(tempDir, "keys.json"), "utf8");
        const parsedKeys: unknown = JSON.parse(keysJson);
        assert.ok(isRecord(parsedKeys));
        assert.ok(isRecord(parsedKeys.providers));
        assert.ok(isRecord(parsedKeys.providers.openai));
        assert.ok(Array.isArray(parsedKeys.providers.openai.accounts));
        assert.ok(isRecord(parsedKeys.providers.openai.accounts[0]));
        assert.equal(parsedKeys.providers.openai.accounts[0].email, "device@example.com");
        assert.equal(parsedKeys.providers.openai.accounts[0].subject, "user-device");
        assert.equal(parsedKeys.providers.openai.accounts[0].plan_type, "plus");
        assert.equal(parsedKeys.providers.openai.accounts[0].chatgpt_account_id, "workspace-device");
      });
    },
  );
});

test("credential list exposes OpenAI emails without reveal mode", async () => {
  const accessToken = makeJwt({
    "https://api.openai.com/auth": {
      chatgpt_account_id: "workspace-visible",
      chatgpt_plan_type: "team",
    },
    "https://api.openai.com/profile": {
      email: "visible@example.com",
    },
    sub: "user-visible",
  });

  await withUiApp({
    providers: {
      openai: {
        auth: "oauth_bearer",
        accounts: [
          {
            id: "openai-visible",
            access_token: accessToken,
            refresh_token: "refresh-visible",
            expires_at: Date.now() + 3_600_000,
          },
        ],
      },
    },
  }, async ({ app }) => {
    const response = await app.inject({
      method: "GET",
      url: "/api/ui/credentials",
    });

    assert.equal(response.statusCode, 200);
    const payload: unknown = response.json();
    assert.ok(isRecord(payload));
    assert.ok(Array.isArray(payload.providers));
    assert.ok(isRecord(payload.providers[0]));
    assert.ok(Array.isArray(payload.providers[0].accounts));
    assert.ok(isRecord(payload.providers[0].accounts[0]));
    assert.equal(payload.providers[0].accounts[0].displayName, "visible@example.com");
    assert.equal(payload.providers[0].accounts[0].email, "visible@example.com");
    assert.equal(payload.providers[0].accounts[0].chatgptAccountId, "workspace-visible");
  });
});
