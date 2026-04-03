import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createApp } from "../app.js";
import type { ProxyConfig } from "../lib/config.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

// The real-format test token from the plan
const VALID_SETUP_TOKEN =
  "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";

async function withUiApp(
  keysPayload: unknown,
  fn: (ctx: { readonly app: Awaited<ReturnType<typeof createApp>>; readonly tempDir: string }) => Promise<void>,
): Promise<void> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "open-hax-setup-token-test-"));
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

// ─── Tests ────────────────────────────────────────────────────────────────────

test("valid setup-token save returns 200 with expected response shape", async () => {
  await withUiApp({ providers: {} }, async ({ app }) => {
    const response = await app.inject({
      method: "POST",
      url: "/api/ui/credentials/anthropic/setup-token",
      payload: { token: VALID_SETUP_TOKEN },
    });

    assert.equal(response.statusCode, 200);
    const body: unknown = response.json();
    assert.ok(isRecord(body));
    assert.equal(body.ok, true);
    assert.equal(body.providerId, "anthropic");
    assert.equal(body.authType, "oauth_bearer");
    assert.equal(body.credentialKind, "setup_token");
    assert.equal(typeof body.accountId, "string");
    // Auto-generated account ID should use claude-setup- prefix
    assert.ok((body.accountId as string).startsWith("claude-setup-"), `accountId should start with 'claude-setup-', got: ${body.accountId}`);
  });
});

test("valid setup-token with explicit accountId saves with that ID", async () => {
  await withUiApp({ providers: {} }, async ({ app }) => {
    const response = await app.inject({
      method: "POST",
      url: "/api/ui/credentials/anthropic/setup-token",
      payload: { token: VALID_SETUP_TOKEN, accountId: "my-custom-account" },
    });

    assert.equal(response.statusCode, 200);
    const body: unknown = response.json();
    assert.ok(isRecord(body));
    assert.equal(body.accountId, "my-custom-account");
  });
});

test("invalid setup-token returns 400", async () => {
  await withUiApp({ providers: {} }, async ({ app }) => {
    const response = await app.inject({
      method: "POST",
      url: "/api/ui/credentials/anthropic/setup-token",
      payload: { token: "sk-wrong-prefix-abc" },
    });

    assert.equal(response.statusCode, 400);
    const body: unknown = response.json();
    assert.ok(isRecord(body));
    assert.equal(body.error, "invalid_setup_token");
    assert.ok(typeof body.detail === "string" && (body.detail as string).length > 0);
  });
});

test("empty token returns 400", async () => {
  await withUiApp({ providers: {} }, async ({ app }) => {
    const response = await app.inject({
      method: "POST",
      url: "/api/ui/credentials/anthropic/setup-token",
      payload: { token: "" },
    });

    assert.equal(response.statusCode, 400);
  });
});

test("missing token field returns 400", async () => {
  await withUiApp({ providers: {} }, async ({ app }) => {
    const response = await app.inject({
      method: "POST",
      url: "/api/ui/credentials/anthropic/setup-token",
      payload: {},
    });

    assert.equal(response.statusCode, 400);
  });
});

test("stored account appears under anthropic provider with oauth_bearer auth type", async () => {
  await withUiApp({ providers: {} }, async ({ app, tempDir }) => {
    // Add setup-token
    const addResponse = await app.inject({
      method: "POST",
      url: "/api/ui/credentials/anthropic/setup-token",
      payload: { token: VALID_SETUP_TOKEN, accountId: "test-setup-account" },
    });
    assert.equal(addResponse.statusCode, 200);

    // Verify persisted data
    const keysJson = await readFile(path.join(tempDir, "keys.json"), "utf8");
    const parsedKeys: unknown = JSON.parse(keysJson);
    assert.ok(isRecord(parsedKeys));
    assert.ok(isRecord((parsedKeys as Record<string, unknown>).providers));

    const providers = (parsedKeys as Record<string, unknown>).providers as Record<string, unknown>;
    assert.ok(isRecord(providers.anthropic));

    const anthropicProvider = providers.anthropic as Record<string, unknown>;
    // On-disk provider-level auth type
    assert.equal(anthropicProvider.auth, "oauth_bearer");
    assert.ok(Array.isArray(anthropicProvider.accounts));

    const accounts = anthropicProvider.accounts as Record<string, unknown>[];
    const setupAccount = accounts.find((a) => a.id === "test-setup-account");
    assert.ok(setupAccount, "setup-token account should be persisted");
    // On-disk format uses access_token, not token
    assert.equal(setupAccount.access_token, VALID_SETUP_TOKEN);
    // Setup-token accounts should NOT have refresh/expiry metadata
    assert.equal(setupAccount.refresh_token, undefined);
    assert.equal(setupAccount.expires_at, undefined);
    assert.equal(setupAccount.email, undefined);
    assert.equal(setupAccount.subject, undefined);
  });
});

test("re-posting same token with different accountId replaces (not duplicates) the credential", async () => {
  await withUiApp({ providers: {} }, async ({ app, tempDir }) => {
    // First save
    const first = await app.inject({
      method: "POST",
      url: "/api/ui/credentials/anthropic/setup-token",
      payload: { token: VALID_SETUP_TOKEN, accountId: "first-account" },
    });
    assert.equal(first.statusCode, 200);

    // Second save — same token, different accountId
    const second = await app.inject({
      method: "POST",
      url: "/api/ui/credentials/anthropic/setup-token",
      payload: { token: VALID_SETUP_TOKEN, accountId: "second-account" },
    });
    assert.equal(second.statusCode, 200);

    // Verify dedup: only ONE account should exist with the token
    const keysJson = await readFile(path.join(tempDir, "keys.json"), "utf8");
    const parsedKeys: unknown = JSON.parse(keysJson);
    assert.ok(isRecord(parsedKeys));
    const providers = (parsedKeys as Record<string, unknown>).providers as Record<string, unknown>;
    assert.ok(isRecord(providers.anthropic));
    const accounts = (providers.anthropic as Record<string, unknown>).accounts as Record<string, unknown>[];

    // upsertOAuthAccount filters by both accountId and token — re-pasting same token
    // with a different accountId should result in only one account
    assert.equal(accounts.length, 1, `Expected 1 account after dedup, got: ${accounts.length}`);
    assert.equal(accounts[0].id, "second-account");
    assert.equal(accounts[0].access_token, VALID_SETUP_TOKEN);
  });
});

test("credential list API shows saved setup-token account", async () => {
  await withUiApp({ providers: {} }, async ({ app }) => {
    // Add setup-token
    await app.inject({
      method: "POST",
      url: "/api/ui/credentials/anthropic/setup-token",
      payload: { token: VALID_SETUP_TOKEN, accountId: "listed-setup" },
    });

    // List credentials
    const listResponse = await app.inject({
      method: "GET",
      url: "/api/ui/credentials",
    });
    assert.equal(listResponse.statusCode, 200);
    const payload: unknown = listResponse.json();
    assert.ok(isRecord(payload));
    assert.ok(Array.isArray(payload.providers));

    const anthropicProvider = (payload.providers as Record<string, unknown>[]).find(
      (p) => (p as Record<string, unknown>).id === "anthropic",
    );
    assert.ok(anthropicProvider, "anthropic provider should appear in credential list");
    assert.ok(Array.isArray((anthropicProvider as Record<string, unknown>).accounts));

    const accounts = (anthropicProvider as Record<string, unknown>).accounts as Record<string, unknown>[];
    const setupAccount = accounts.find((a) => a.id === "listed-setup");
    assert.ok(setupAccount, "setup-token account should appear in credential list");
    assert.equal(setupAccount.authType, "oauth_bearer");
  });
});

test("removing a setup-token account works via existing removal path", async () => {
  await withUiApp({ providers: {} }, async ({ app }) => {
    // Add setup-token
    await app.inject({
      method: "POST",
      url: "/api/ui/credentials/anthropic/setup-token",
      payload: { token: VALID_SETUP_TOKEN, accountId: "removable-setup" },
    });

    // Remove it
    const removeResponse = await app.inject({
      method: "DELETE",
      url: "/api/ui/credentials/account",
      payload: { providerId: "anthropic", accountId: "removable-setup" },
    });
    assert.equal(removeResponse.statusCode, 200);
    const removeBody: unknown = removeResponse.json();
    assert.ok(isRecord(removeBody));
    assert.equal(removeBody.ok, true);

    // Verify it's gone
    const listResponse = await app.inject({
      method: "GET",
      url: "/api/ui/credentials",
    });
    const payload: unknown = listResponse.json();
    assert.ok(isRecord(payload));
    const providers = payload.providers as Record<string, unknown>[];
    const anthropicProvider = providers.find((p) => (p as Record<string, unknown>).id === "anthropic");
    // Provider should either not exist or have no accounts
    if (anthropicProvider) {
      const accounts = (anthropicProvider as Record<string, unknown>).accounts as Record<string, unknown>[];
      assert.equal(accounts.length, 0, "no accounts should remain after removal");
    }
  });
});
