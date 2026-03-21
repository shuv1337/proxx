import assert from "node:assert/strict";
import test from "node:test";

import { AnthropicOAuthManager } from "../lib/anthropic-oauth.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function jsonResponse(payload: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(payload), {
    status: init.status ?? 200,
    headers: {
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
  });
}

function makeJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${header}.${body}.sig`;
}

function createMockFetch(
  handlers: Record<string, (req: Request) => Promise<Response> | Response>,
) {
  return async (
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    for (const [pattern, handler] of Object.entries(handlers)) {
      if (url.includes(pattern)) {
        const req = new Request(url, init);
        return handler(req);
      }
    }
    return new Response("not found", { status: 404 });
  };
}

// ─── startCodeFlow: URL generation ───────────────────────────────────────────

test("startCodeFlow: returns correct authorizeUrl and verifier", async () => {
  const manager = new AnthropicOAuthManager({
    clientId: "test-client-id",
    oauthScopes: "org:create_api_key user:profile user:inference user:sessions:claude_code user:mcp_servers user:file_upload",
  });

  const result = await manager.startCodeFlow();

  assert.ok(result.authorizeUrl.length > 0, "authorizeUrl should be non-empty");
  assert.ok(result.verifier.length > 0, "verifier should be non-empty");

  const parsed = new URL(result.authorizeUrl);

  // Must target claude.ai authorize endpoint (NOT the issuer)
  assert.equal(parsed.origin, "https://claude.ai");
  assert.equal(parsed.pathname, "/oauth/authorize");

  // Required params
  assert.equal(parsed.searchParams.get("code"), "true");
  assert.equal(parsed.searchParams.get("client_id"), "test-client-id");
  assert.equal(parsed.searchParams.get("response_type"), "code");
  assert.equal(
    parsed.searchParams.get("redirect_uri"),
    "http://localhost:53692/callback",
    "redirect_uri must be Anthropic's own callback URL",
  );
  assert.equal(
    parsed.searchParams.get("scope"),
    "org:create_api_key user:profile user:inference user:sessions:claude_code user:mcp_servers user:file_upload",
  );
  assert.equal(parsed.searchParams.get("code_challenge_method"), "S256");
  assert.ok(
    (parsed.searchParams.get("code_challenge")?.length ?? 0) > 0,
    "code_challenge must be present",
  );

  // State is reused as the PKCE verifier
  assert.equal(
    parsed.searchParams.get("state"),
    result.verifier,
    "state must equal the PKCE verifier",
  );
});

test("startCodeFlow: uses default client ID and scopes when not configured", async () => {
  const manager = new AnthropicOAuthManager();

  const result = await manager.startCodeFlow();
  const parsed = new URL(result.authorizeUrl);

  assert.equal(
    parsed.searchParams.get("client_id"),
    "9d1c250a-e61b-44d9-88ed-5944d1962f5e",
    "default client ID should match the public Anthropic client",
  );
  assert.equal(
    parsed.searchParams.get("scope"),
    "org:create_api_key user:profile user:inference user:sessions:claude_code user:mcp_servers user:file_upload",
    "default scopes should match Anthropic's required scopes",
  );
});

test("startCodeFlow: each call produces a unique verifier", async () => {
  const manager = new AnthropicOAuthManager();

  const a = await manager.startCodeFlow();
  const b = await manager.startCodeFlow();

  assert.notEqual(a.verifier, b.verifier, "verifiers must be unique per call");
  assert.notEqual(
    a.authorizeUrl,
    b.authorizeUrl,
    "authorize URLs must differ (different PKCE challenges)",
  );
});

// ─── exchangeCode: success with # separator ───────────────────────────────────

test("exchangeCode: splits code on # and sends both parts to token endpoint", async () => {
  const accessJwt = makeJwt({ sub: "user_abc", email: "user@example.com" });
  let capturedBody: Record<string, unknown> = {};

  const manager = new AnthropicOAuthManager({
    clientId: "client-id",
    issuer: "https://platform.claude.com",
    fetchFn: createMockFetch({
      "/v1/oauth/token": async (req) => {
        capturedBody = await req.json() as Record<string, unknown>;
        return jsonResponse({
          access_token: accessJwt,
          refresh_token: "refresh-tok",
          expires_in: 3600,
        });
      },
    }),
  });

  const { verifier } = await manager.startCodeFlow();
  // In Anthropic's flow, the # fragment is the verifier (state = verifier)
  const tokens = await manager.exchangeCode(`real-code#${verifier}`, verifier);

  // Verify the split was applied correctly
  assert.equal(capturedBody["code"], "real-code");
  assert.equal(capturedBody["state"], verifier);
  assert.equal(capturedBody["grant_type"], "authorization_code");
  assert.equal(capturedBody["client_id"], "client-id");
  assert.equal(
    capturedBody["redirect_uri"],
    "http://localhost:53692/callback",
  );
  assert.equal(capturedBody["code_verifier"], verifier);

  // Verify returned tokens
  assert.equal(tokens.accessToken, accessJwt);
  assert.equal(tokens.refreshToken, "refresh-tok");
  assert.ok(typeof tokens.expiresAt === "number", "expiresAt should be a number");
  assert.equal(tokens.subject, "user_abc");
  assert.equal(tokens.email, "user@example.com");
  assert.ok(
    tokens.accountId.startsWith("anthropic-"),
    `accountId should start with anthropic-, got: ${tokens.accountId}`,
  );
});

// ─── exchangeCode: success with plain code (no #) ────────────────────────────

test("exchangeCode: handles plain code without # separator", async () => {
  const accessJwt = makeJwt({ sub: "user_plain" });
  let capturedBody: Record<string, unknown> = {};

  const manager = new AnthropicOAuthManager({
    clientId: "client-id",
    fetchFn: createMockFetch({
      "/v1/oauth/token": async (req) => {
        capturedBody = await req.json() as Record<string, unknown>;
        return jsonResponse({
          access_token: accessJwt,
          expires_in: 3600,
        });
      },
    }),
  });

  const { verifier } = await manager.startCodeFlow();
  const tokens = await manager.exchangeCode("plain-code-no-hash", verifier);

  assert.equal(capturedBody["code"], "plain-code-no-hash");
  // When there's no # fragment, state falls back to the verifier
  assert.equal(capturedBody["state"], verifier);
  assert.equal(tokens.subject, "user_plain");
});

// ─── exchangeCode: token endpoint uses JSON, not URL-encoded ─────────────────

test("exchangeCode: sends Content-Type: application/json (not url-encoded)", async () => {
  const accessJwt = makeJwt({ sub: "user_json" });
  let capturedContentType = "";

  const manager = new AnthropicOAuthManager({
    clientId: "client-id",
    fetchFn: createMockFetch({
      "/v1/oauth/token": async (req) => {
        capturedContentType = req.headers.get("content-type") ?? "";
        return jsonResponse({ access_token: accessJwt, expires_in: 3600 });
      },
    }),
  });

  const { verifier } = await manager.startCodeFlow();
  await manager.exchangeCode("some-code", verifier);

  assert.ok(
    capturedContentType.toLowerCase().includes("application/json"),
    `Content-Type must be application/json, got: ${capturedContentType}`,
  );
});

// ─── exchangeCode: full URL parsing ───────────────────────────────────────────

test("exchangeCode: parses code and state from a full redirect URL", async () => {
  const accessJwt = makeJwt({ sub: "user_url" });
  let capturedBody: Record<string, unknown> = {};

  const manager = new AnthropicOAuthManager({
    clientId: "client-id",
    fetchFn: createMockFetch({
      "/v1/oauth/token": async (req) => {
        capturedBody = await req.json() as Record<string, unknown>;
        return jsonResponse({
          access_token: accessJwt,
          refresh_token: "refresh-url",
          expires_in: 3600,
        });
      },
    }),
  });

  const { verifier } = await manager.startCodeFlow();
  // Simulate pasting the full failed redirect URL from the browser
  const fullUrl = `http://localhost:53692/callback?code=the-auth-code&state=${verifier}`;
  const tokens = await manager.exchangeCode(fullUrl, verifier);

  assert.equal(capturedBody["code"], "the-auth-code");
  assert.equal(capturedBody["state"], verifier);
  assert.equal(capturedBody["code_verifier"], verifier);
  assert.equal(tokens.subject, "user_url");
});

test("exchangeCode: parses query-param format (code=X&state=Y)", async () => {
  const accessJwt = makeJwt({ sub: "user_qp" });
  let capturedBody: Record<string, unknown> = {};

  const manager = new AnthropicOAuthManager({
    clientId: "client-id",
    fetchFn: createMockFetch({
      "/v1/oauth/token": async (req) => {
        capturedBody = await req.json() as Record<string, unknown>;
        return jsonResponse({
          access_token: accessJwt,
          expires_in: 3600,
        });
      },
    }),
  });

  const { verifier } = await manager.startCodeFlow();
  const tokens = await manager.exchangeCode(`code=qp-code&state=${verifier}`, verifier);

  assert.equal(capturedBody["code"], "qp-code");
  assert.equal(capturedBody["state"], verifier);
  assert.equal(tokens.subject, "user_qp");
});

test("exchangeCode: rejects when parsed state mismatches verifier", async () => {
  const manager = new AnthropicOAuthManager({
    clientId: "client-id",
    fetchFn: createMockFetch({
      "/v1/oauth/token": async () => jsonResponse({ access_token: makeJwt({}), expires_in: 3600 }),
    }),
  });

  const { verifier } = await manager.startCodeFlow();
  await assert.rejects(
    () => manager.exchangeCode(`http://localhost:53692/callback?code=c&state=wrong-state`, verifier),
    /state mismatch/i,
  );
});

// ─── exchangeCode: failure on non-ok response ─────────────────────────────────

test("exchangeCode: throws on non-ok response", async () => {
  const manager = new AnthropicOAuthManager({
    clientId: "client-id",
    fetchFn: createMockFetch({
      "/v1/oauth/token": () => new Response("Bad Request", { status: 400 }),
    }),
  });

  const { verifier } = await manager.startCodeFlow();

  await assert.rejects(
    manager.exchangeCode("bad-code", verifier),
    /Anthropic code exchange failed with status 400/,
  );
});

// ─── refreshToken: success ────────────────────────────────────────────────────

test("refreshToken: POSTs JSON with refresh_token grant to /v1/oauth/token", async () => {
  let capturedBody: Record<string, unknown> = {};
  let capturedContentType = "";
  const newAccessJwt = makeJwt({ sub: "user_refresh" });

  const manager = new AnthropicOAuthManager({
    clientId: "client-id",
    issuer: "https://platform.claude.com",
    fetchFn: createMockFetch({
      "/v1/oauth/token": async (req) => {
        capturedContentType = req.headers.get("content-type") ?? "";
        capturedBody = await req.json() as Record<string, unknown>;
        return jsonResponse({
          access_token: newAccessJwt,
          refresh_token: "new-refresh-tok",
          expires_in: 7200,
        });
      },
    }),
  });

  const tokens = await manager.refreshToken("old-refresh-tok");

  // Verify request body
  assert.equal(capturedBody["grant_type"], "refresh_token");
  assert.equal(capturedBody["refresh_token"], "old-refresh-tok");
  assert.equal(capturedBody["client_id"], "client-id");

  // Verify JSON content type
  assert.ok(
    capturedContentType.toLowerCase().includes("application/json"),
    `Content-Type must be application/json, got: ${capturedContentType}`,
  );

  // Verify returned tokens
  assert.equal(tokens.accessToken, newAccessJwt);
  assert.equal(tokens.refreshToken, "new-refresh-tok");
  assert.ok(typeof tokens.expiresAt === "number");
  assert.equal(tokens.accountId, "anthropic-user_refresh");
});

// ─── refreshToken: failure ────────────────────────────────────────────────────

test("refreshToken: throws on non-ok response", async () => {
  const manager = new AnthropicOAuthManager({
    clientId: "client-id",
    fetchFn: createMockFetch({
      "/v1/oauth/token": () => new Response("Unauthorized", { status: 401 }),
    }),
  });

  await assert.rejects(
    manager.refreshToken("bad-token"),
    /Anthropic token refresh failed with status 401/,
  );
});

// ─── Account ID derivation ────────────────────────────────────────────────────

test("account ID: derives anthropic-{sub} from sub claim", async () => {
  const accessJwt = makeJwt({ sub: "user_123" });

  const manager = new AnthropicOAuthManager({
    clientId: "client-id",
    fetchFn: createMockFetch({
      "/v1/oauth/token": () =>
        jsonResponse({ access_token: accessJwt, expires_in: 3600 }),
    }),
  });

  const { verifier } = await manager.startCodeFlow();
  const tokens = await manager.exchangeCode("code", verifier);

  assert.equal(tokens.accountId, "anthropic-user_123");
  assert.equal(tokens.subject, "user_123");
});

test("account ID: derives anthropic-{sha256 prefix} from email when no sub", async () => {
  const accessJwt = makeJwt({ email: "test@example.com" });

  const manager = new AnthropicOAuthManager({
    clientId: "client-id",
    fetchFn: createMockFetch({
      "/v1/oauth/token": () =>
        jsonResponse({ access_token: accessJwt, expires_in: 3600 }),
    }),
  });

  const { verifier } = await manager.startCodeFlow();
  const tokens = await manager.exchangeCode("code", verifier);

  assert.ok(
    tokens.accountId.startsWith("anthropic-"),
    `accountId should start with 'anthropic-', got: ${tokens.accountId}`,
  );
  assert.ok(
    !tokens.accountId.includes("test@example.com"),
    "accountId must not contain the raw email",
  );
  // Suffix should be a 16-char hex digest (sha256 prefix)
  const suffix = tokens.accountId.slice("anthropic-".length);
  assert.match(suffix, /^[0-9a-f]{16}$/, "suffix must be 16 lowercase hex chars");
  assert.equal(tokens.email, "test@example.com");
});

test("account ID: falls back to anthropic-{timestamp} when no sub or email", async () => {
  let now = 1_234_567_890;
  const accessJwt = makeJwt({}); // no sub, no email

  const manager = new AnthropicOAuthManager({
    clientId: "client-id",
    now: () => now,
    fetchFn: createMockFetch({
      "/v1/oauth/token": () =>
        jsonResponse({ access_token: accessJwt, expires_in: 3600 }),
    }),
  });

  const { verifier } = await manager.startCodeFlow();
  const tokens = await manager.exchangeCode("code", verifier);

  assert.equal(tokens.accountId, `anthropic-${now}`);
});

// ─── isTokenExpired ───────────────────────────────────────────────────────────

test("isTokenExpired: returns true when expiresAt is within default 60s buffer", () => {
  const now = 1_000_000;
  const manager = new AnthropicOAuthManager({ now: () => now });

  // Expires in 30 s — within the 60 s default buffer
  assert.equal(manager.isTokenExpired(now + 30_000), true);

  // Expires in 2 min — outside the 60 s default buffer
  assert.equal(manager.isTokenExpired(now + 2 * 60_000), false);

  // Already past expiry
  assert.equal(manager.isTokenExpired(now - 1_000), true);

  // undefined → treated as non-expiring
  assert.equal(manager.isTokenExpired(undefined), false);
});

test("isTokenExpired: respects custom buffer", () => {
  const now = 2_000_000;
  const manager = new AnthropicOAuthManager({ now: () => now });

  const expiresAt = now + 4 * 60_000; // expires in 4 min

  // 5-min buffer → 4-min-away token is expired
  assert.equal(manager.isTokenExpired(expiresAt, 5 * 60_000), true);

  // 3-min buffer → 4-min-away token is not expired
  assert.equal(manager.isTokenExpired(expiresAt, 3 * 60_000), false);
});

// ─── Token endpoint URL includes /v1/ prefix ──────────────────────────────────

test("exchangeCode: calls {issuer}/v1/oauth/token (with /v1/ prefix)", async () => {
  const accessJwt = makeJwt({ sub: "user_url_check" });
  let capturedUrl = "";

  const manager = new AnthropicOAuthManager({
    clientId: "client-id",
    issuer: "https://platform.claude.com",
    fetchFn: async (input) => {
      capturedUrl =
        typeof input === "string" ? input
        : input instanceof URL ? input.toString()
        : (input as Request).url;
      return jsonResponse({ access_token: accessJwt, expires_in: 3600 });
    },
  });

  const { verifier } = await manager.startCodeFlow();
  await manager.exchangeCode("code", verifier);

  assert.equal(
    capturedUrl,
    "https://platform.claude.com/v1/oauth/token",
    "token endpoint must include the /v1/ prefix",
  );
});

test("refreshToken: calls {issuer}/v1/oauth/token (with /v1/ prefix)", async () => {
  const accessJwt = makeJwt({ sub: "user_url_check" });
  let capturedUrl = "";

  const manager = new AnthropicOAuthManager({
    clientId: "client-id",
    issuer: "https://platform.claude.com",
    fetchFn: async (input) => {
      capturedUrl =
        typeof input === "string" ? input
        : input instanceof URL ? input.toString()
        : (input as Request).url;
      return jsonResponse({ access_token: accessJwt, expires_in: 3600 });
    },
  });

  await manager.refreshToken("some-refresh-token");

  assert.equal(
    capturedUrl,
    "https://platform.claude.com/v1/oauth/token",
    "token endpoint must include the /v1/ prefix",
  );
});
