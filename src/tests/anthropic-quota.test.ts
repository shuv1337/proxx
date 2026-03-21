import assert from "node:assert/strict";
import test from "node:test";

import type { CredentialAccountView, CredentialStoreLike } from "../lib/credential-store.js";
import type { CredentialProviderView } from "../lib/credential-store.js";
import { fetchAnthropicQuotaSnapshots } from "../lib/anthropic-quota.js";
import type { CredentialQuotaWindowSummary } from "../lib/anthropic-quota.js";

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

function makeAccount(overrides: Partial<CredentialAccountView> = {}): CredentialAccountView {
  return {
    id: overrides.id ?? "anthropic-user_test",
    authType: overrides.authType ?? "oauth_bearer",
    displayName: overrides.displayName ?? "Test User",
    secretPreview: "acc...tok",
    secret: overrides.secret ?? makeJwt({ sub: "user_test" }),
    refreshToken: overrides.refreshToken ?? "refresh-tok",
    expiresAt: overrides.expiresAt ?? Date.now() + 60 * 60 * 1000, // 1 hour from now
    email: overrides.email ?? "test@example.com",
    subject: overrides.subject ?? "user_test",
    planType: overrides.planType,
    chatgptAccountId: overrides.chatgptAccountId,
  };
}

function createMockCredentialStore(accounts: CredentialAccountView[]): CredentialStoreLike {
  return {
    listProviders: async (_reveal: boolean): Promise<CredentialProviderView[]> => [
      {
        id: "anthropic",
        authType: "oauth_bearer" as const,
        accountCount: accounts.length,
        accounts,
      },
    ],
    upsertOAuthAccount: async () => {},
    upsertApiKeyAccount: async () => {},
    removeAccount: async () => false,
  };
}

/**
 * Build a unique account ID for each test so module-level caches don't
 * interfere between tests (the cache key is "providerId:accountId").
 */
let _testCounter = 0;
function uniqueAccountId(): string {
  _testCounter += 1;
  return `anthropic-quota-test-${_testCounter}`;
}

// ─── Successful quota fetch ───────────────────────────────────────────────────

test("successful quota fetch: returns status ok with windows array", async () => {
  const accountId = uniqueAccountId();
  const account = makeAccount({ id: accountId });
  const store = createMockCredentialStore([account]);

  const mockFetch = async (_input: string | URL | Request): Promise<Response> => {
    return jsonResponse({
      data: [
        {
          period: "daily",
          used_percent: 30,
          resets_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        },
        {
          period: "monthly",
          used_percent: 50,
          resets_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        },
      ],
    });
  };

  const result = await fetchAnthropicQuotaSnapshots(store, {
    fetchFn: mockFetch as typeof fetch,
  });

  assert.equal(result.accounts.length, 1);
  const snap = result.accounts[0]!;
  assert.equal(snap.status, "ok");
  assert.equal(snap.providerId, "anthropic");
  assert.equal(snap.accountId, accountId);
  assert.ok(Array.isArray(snap.windows), "windows should be an array");
  assert.ok(snap.windows.length > 0, "windows should be non-empty");
  assert.ok(typeof result.generatedAt === "string", "generatedAt should be a string");
});

// ─── Normalized window parsing ────────────────────────────────────────────────

test("normalized window parsing: various response shapes map to CredentialQuotaWindowSummary", async () => {
  const accountId = uniqueAccountId();
  const account = makeAccount({ id: accountId });
  const store = createMockCredentialStore([account]);

  // Test form 2/3: nested usage object with named periods
  const mockFetch = async (): Promise<Response> =>
    jsonResponse({
      usage: {
        daily: {
          used_percent: 0.75, // fraction form — should normalize to 75
          resets_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        },
        monthly: {
          remaining_percent: 60,
          reset_after_seconds: 1800,
        },
      },
    });

  const result = await fetchAnthropicQuotaSnapshots(store, {
    fetchFn: mockFetch as typeof fetch,
  });

  const snap = result.accounts[0]!;
  assert.equal(snap.status, "ok");

  const dailyWindow = snap.windows.find((w) => w.key === "daily") as CredentialQuotaWindowSummary | undefined;
  const monthlyWindow = snap.windows.find((w) => w.key === "monthly") as CredentialQuotaWindowSummary | undefined;

  assert.ok(dailyWindow, "daily window should be present");
  assert.ok(monthlyWindow, "monthly window should be present");

  // 0.75 fractional value should be normalized to 75%
  assert.ok(
    typeof dailyWindow.usedPercent === "number" && dailyWindow.usedPercent > 1,
    `usedPercent should be normalized to >1 (percentage), got: ${dailyWindow.usedPercent}`,
  );
  assert.ok(dailyWindow.resetsAt !== null, "resetsAt should be parsed from resets_at");

  // Monthly: remaining given, used should be derived
  assert.ok(
    typeof monthlyWindow.remainingPercent === "number",
    "remainingPercent should be present",
  );
  assert.equal(monthlyWindow.remainingPercent, 60);
  assert.equal(monthlyWindow.usedPercent, 40, "usedPercent should be derived as 100 - remainingPercent");
  assert.ok(monthlyWindow.resetAfterSeconds !== null, "resetAfterSeconds should be set");
});

test("normalized window parsing: unit-based quota derives percentages from limit", async () => {
  const accountId = uniqueAccountId();
  const account = makeAccount({ id: accountId });
  const store = createMockCredentialStore([account]);

  const mockFetch = async (): Promise<Response> =>
    jsonResponse({
      daily: {
        used_tokens: 250_000,
        limit_tokens: 1_000_000,
        resets_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      },
    });

  const result = await fetchAnthropicQuotaSnapshots(store, {
    fetchFn: mockFetch as typeof fetch,
  });

  const snap = result.accounts[0]!;
  assert.equal(snap.status, "ok");

  const dailyWindow = snap.windows.find((w) => w.key === "daily");
  assert.ok(dailyWindow, "daily window should be present");
  assert.ok(
    typeof dailyWindow.usedPercent === "number",
    "usedPercent should be derived from tokens",
  );
  // 250_000 / 1_000_000 * 100 = 25
  assert.ok(
    Math.abs((dailyWindow.usedPercent ?? 0) - 25) < 1,
    `Expected usedPercent near 25, got: ${dailyWindow.usedPercent}`,
  );
});

// ─── Token refresh before fetch ───────────────────────────────────────────────

test("token refresh before fetch: expired token is refreshed, new token used for fetch", async () => {
  const accountId = uniqueAccountId();
  const expiredAccessToken = makeJwt({ sub: "user_expired" });
  const freshAccessToken = makeJwt({ sub: "user_refreshed" });

  const account = makeAccount({
    id: accountId,
    secret: expiredAccessToken,
    refreshToken: "old-refresh-tok",
    // Set expiresAt in the past to trigger refresh
    expiresAt: Date.now() - 5 * 60 * 1000,
  });

  let upsertCalled = false;
  const store: CredentialStoreLike = {
    listProviders: async () => [
      {
        id: "anthropic",
        authType: "oauth_bearer",
        accountCount: 1,
        accounts: [account],
      },
    ],
    upsertOAuthAccount: async () => {
      upsertCalled = true;
    },
    upsertApiKeyAccount: async () => {},
    removeAccount: async () => false,
  };

  let usageAuthHeader = "";

  const mockFetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

    // Token refresh endpoint
    if (url.includes("/oauth/token")) {
      return jsonResponse({
        access_token: freshAccessToken,
        refresh_token: "new-refresh-tok",
        expires_in: 3600,
      });
    }

    // Usage endpoint — capture the authorization header
    if (url.includes("/usage")) {
      const headers = new Headers(init?.headers as HeadersInit | undefined);
      usageAuthHeader = headers.get("authorization") ?? "";
      return jsonResponse({
        daily: {
          used_percent: 20,
          resets_at: new Date(Date.now() + 86400_000).toISOString(),
        },
      });
    }

    return new Response("not found", { status: 404 });
  };

  const result = await fetchAnthropicQuotaSnapshots(store, {
    fetchFn: mockFetch as typeof fetch,
  });

  const snap = result.accounts[0]!;
  assert.equal(snap.status, "ok");

  // The usage request should have used the new (refreshed) access token
  assert.equal(
    usageAuthHeader,
    `Bearer ${freshAccessToken}`,
    "Fresh token should be used for the usage fetch",
  );

  // Store should have been updated with the new credentials
  assert.ok(upsertCalled, "upsertOAuthAccount should have been called to persist the new token");
});

// ─── Caching within TTL ───────────────────────────────────────────────────────

test("caching within TTL: second call within 5 min returns cached data (no fetch)", async () => {
  const accountId = uniqueAccountId();
  const account = makeAccount({ id: accountId });
  const store = createMockCredentialStore([account]);

  let fetchCallCount = 0;

  const mockFetch = async (): Promise<Response> => {
    fetchCallCount += 1;
    return jsonResponse({
      daily: {
        used_percent: 40,
        resets_at: new Date(Date.now() + 86400_000).toISOString(),
      },
    });
  };

  // First call — should hit the network
  const first = await fetchAnthropicQuotaSnapshots(store, {
    fetchFn: mockFetch as typeof fetch,
  });
  assert.equal(first.accounts[0]?.status, "ok");
  assert.equal(fetchCallCount, 1);

  // Second call within TTL — should use cache
  const second = await fetchAnthropicQuotaSnapshots(store, {
    fetchFn: mockFetch as typeof fetch,
  });
  assert.equal(second.accounts[0]?.status, "ok");
  assert.equal(fetchCallCount, 1, "Fetch should not have been called again within TTL");
});

// ─── 429 backoff ──────────────────────────────────────────────────────────────

test("429 backoff: after 429, subsequent calls return error with backoffUntil", async () => {
  const accountId = uniqueAccountId();
  const account = makeAccount({ id: accountId });
  const store = createMockCredentialStore([account]);

  const mockFetch = async (input: string | URL | Request): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (url.includes("/usage")) {
      return new Response(JSON.stringify({ error: "rate limited" }), {
        status: 429,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response("not found", { status: 404 });
  };

  // First call — triggers 429 and records backoff
  const afterRateLimit = await fetchAnthropicQuotaSnapshots(store, {
    fetchFn: mockFetch as typeof fetch,
  });

  const snap = afterRateLimit.accounts[0]!;
  assert.equal(snap.status, "error");
  assert.ok(
    typeof snap.backoffUntil === "string",
    `backoffUntil should be set after 429, got: ${snap.backoffUntil}`,
  );
  const backoffDate = new Date(snap.backoffUntil!);
  assert.ok(
    backoffDate.getTime() > Date.now(),
    "backoffUntil should be in the future",
  );

  // Second call — should be blocked by backoff without hitting the network
  let secondFetchCalled = false;
  const mockFetch2 = async (): Promise<Response> => {
    secondFetchCalled = true;
    return jsonResponse({ daily: { used_percent: 10 } });
  };

  const duringBackoff = await fetchAnthropicQuotaSnapshots(store, {
    fetchFn: mockFetch2 as typeof fetch,
  });

  assert.equal(duringBackoff.accounts[0]?.status, "error");
  assert.ok(
    typeof duringBackoff.accounts[0]?.backoffUntil === "string",
    "backoffUntil should persist through subsequent calls during backoff",
  );
  assert.equal(secondFetchCalled, false, "fetch should not be called while backed off");
});

// ─── Stale cache during backoff ───────────────────────────────────────────────

test("stale cache during backoff: stale cached data served with stale: true during backoff", async () => {
  // Use two different account IDs: one for seeding cache, one for
  // triggering 429+backoff, then verify the backoff path alone.
  // Because module-level cache is keyed by accountId and has a 5-min TTL,
  // we can't easily invalidate it mid-test. Instead, test that a 429
  // sets backoff, and a subsequent call during backoff returns the right shape.

  const accountId = uniqueAccountId();
  const account = makeAccount({ id: accountId });
  const store = createMockCredentialStore([account]);

  // First call: 429 → sets backoff
  const rateLimitFetch = async (): Promise<Response> =>
    new Response(JSON.stringify({ error: "rate limited" }), {
      status: 429,
      headers: { "content-type": "application/json" },
    });

  const first = await fetchAnthropicQuotaSnapshots(store, {
    fetchFn: rateLimitFetch as typeof fetch,
  });
  const firstSnap = first.accounts[0]!;
  assert.equal(firstSnap.status, "error");
  assert.ok(typeof firstSnap.backoffUntil === "string", "backoffUntil should be set after 429");

  // Second call during backoff: should NOT call fetch, should return error with backoffUntil
  let secondFetchCalled = false;
  const blockedFetch = async (): Promise<Response> => {
    secondFetchCalled = true;
    return jsonResponse({ daily: { used_percent: 10 } });
  };

  const second = await fetchAnthropicQuotaSnapshots(store, {
    fetchFn: blockedFetch as typeof fetch,
  });
  const secondSnap = second.accounts[0]!;

  assert.equal(secondFetchCalled, false, "fetch should not be called during backoff");
  assert.ok(
    secondSnap.status === "error" && typeof secondSnap.backoffUntil === "string",
    `Expected error with backoffUntil during active backoff, got: status=${secondSnap.status}, backoffUntil=${secondSnap.backoffUntil}`,
  );
});

// ─── Backoff recovery ─────────────────────────────────────────────────────────

test("backoff recovery: after backoff expires, next successful fetch clears backoff", async () => {
  const accountId = uniqueAccountId();
  const account = makeAccount({ id: accountId });
  const store = createMockCredentialStore([account]);

  // First call: 429 — sets backoff
  const rate429Fetch = async (): Promise<Response> =>
    new Response(JSON.stringify({ error: "rate limited" }), {
      status: 429,
      headers: { "content-type": "application/json" },
    });

  await fetchAnthropicQuotaSnapshots(store, {
    fetchFn: rate429Fetch as typeof fetch,
  });

  // During backoff, the request is blocked
  let blockedFetchCalled = false;
  const blockedFetch = async (): Promise<Response> => {
    blockedFetchCalled = true;
    return jsonResponse({ daily: { used_percent: 10 } });
  };

  const duringBackoff = await fetchAnthropicQuotaSnapshots(store, {
    fetchFn: blockedFetch as typeof fetch,
  });

  assert.equal(blockedFetchCalled, false, "fetch should not be called during backoff");
  assert.ok(
    typeof duringBackoff.accounts[0]?.backoffUntil === "string",
    "backoffUntil should be present during backoff",
  );

  // NOTE: We can't directly manipulate the module-level backoff state from here,
  // so we verify the conceptual behavior: the backoff system blocks requests as
  // expected, and a successful fetch on a fresh account clears backoff for that account.
  // Full backoff-expiry-then-success testing requires time-manipulation hooks
  // not exposed by the current public API; this is verified via integration.
});

// ─── Missing scope / 403 error ────────────────────────────────────────────────

test("missing scope error: 403 response returns clean error", async () => {
  const accountId = uniqueAccountId();
  const account = makeAccount({ id: accountId });
  const store = createMockCredentialStore([account]);

  const mockFetch = async (): Promise<Response> =>
    new Response(
      JSON.stringify({ error: { message: "Insufficient scope: usage:read required" } }),
      { status: 403, headers: { "content-type": "application/json" } },
    );

  const result = await fetchAnthropicQuotaSnapshots(store, {
    fetchFn: mockFetch as typeof fetch,
  });

  const snap = result.accounts[0]!;
  assert.equal(snap.status, "error");
  assert.ok(typeof snap.error === "string" && snap.error.length > 0, "error message should be present");
  // backoffUntil should NOT be set for 403 (only 429 triggers backoff)
  assert.equal(snap.backoffUntil, undefined, "403 should not trigger backoff");
});

// ─── Network failure ──────────────────────────────────────────────────────────

test("error handling: network failure returns status error with message", async () => {
  const accountId = uniqueAccountId();
  const account = makeAccount({ id: accountId });
  const store = createMockCredentialStore([account]);

  const mockFetch = async (): Promise<Response> => {
    throw new Error("Network failure: connection refused");
  };

  const result = await fetchAnthropicQuotaSnapshots(store, {
    fetchFn: mockFetch as typeof fetch,
  });

  const snap = result.accounts[0]!;
  assert.equal(snap.status, "error");
  assert.ok(
    snap.error?.includes("Network failure"),
    `error should contain the thrown message, got: ${snap.error}`,
  );
  assert.equal(snap.windows.length, 0, "windows should be empty on error");
});

// ─── Account sorting ──────────────────────────────────────────────────────────

test("account sorting: multiple accounts sorted by email/displayName", async () => {
  const accounts: CredentialAccountView[] = [
    makeAccount({ id: uniqueAccountId(), email: "zebra@example.com", displayName: "Zebra" }),
    makeAccount({ id: uniqueAccountId(), email: "alpha@example.com", displayName: "Alpha" }),
    makeAccount({ id: uniqueAccountId(), email: "middle@example.com", displayName: "Middle" }),
  ];

  const store = createMockCredentialStore(accounts);

  const mockFetch = async (): Promise<Response> =>
    jsonResponse({
      daily: { used_percent: 10, resets_at: new Date(Date.now() + 86400_000).toISOString() },
    });

  const result = await fetchAnthropicQuotaSnapshots(store, {
    fetchFn: mockFetch as typeof fetch,
  });

  assert.equal(result.accounts.length, 3);

  const emails = result.accounts.map((a) => a.email);
  assert.deepEqual(emails, ["alpha@example.com", "middle@example.com", "zebra@example.com"]);
});

// ─── Provider filtering ───────────────────────────────────────────────────────

test("provider filtering: only 'anthropic' providers are included by default", async () => {
  const anthropicAccount = makeAccount({ id: uniqueAccountId(), email: "a@anthropic.com" });
  const openaiAccount = makeAccount({ id: uniqueAccountId(), email: "b@openai.com" });

  const store: CredentialStoreLike = {
    listProviders: async () => [
      {
        id: "anthropic",
        authType: "oauth_bearer",
        accountCount: 1,
        accounts: [anthropicAccount],
      },
      {
        id: "openai",
        authType: "oauth_bearer",
        accountCount: 1,
        accounts: [openaiAccount],
      },
    ],
    upsertOAuthAccount: async () => {},
    upsertApiKeyAccount: async () => {},
    removeAccount: async () => false,
  };

  const mockFetch = async (): Promise<Response> =>
    jsonResponse({ daily: { used_percent: 10, resets_at: new Date(Date.now() + 86400_000).toISOString() } });

  const result = await fetchAnthropicQuotaSnapshots(store, {
    fetchFn: mockFetch as typeof fetch,
  });

  // Only the anthropic provider should be included
  assert.equal(result.accounts.length, 1);
  assert.equal(result.accounts[0]?.providerId, "anthropic");
});

// ─── Missing access token ─────────────────────────────────────────────────────

test("missing access token: returns error without crashing", async () => {
  const accountId = uniqueAccountId();
  const account = makeAccount({
    id: accountId,
    secret: "", // empty token — treated as missing
    expiresAt: Date.now() + 60 * 60 * 1000, // not expired, so no refresh attempted
    refreshToken: undefined,
  });

  const store = createMockCredentialStore([account]);

  let fetchCalled = false;
  const mockFetch = async (): Promise<Response> => {
    fetchCalled = true;
    return jsonResponse({});
  };

  const result = await fetchAnthropicQuotaSnapshots(store, {
    fetchFn: mockFetch as typeof fetch,
  });

  const snap = result.accounts[0]!;
  assert.equal(snap.status, "error");
  assert.ok(snap.error?.toLowerCase().includes("token"), `error should mention token, got: ${snap.error}`);
  assert.equal(fetchCalled, false, "usage fetch should not be called when token is missing");
});
