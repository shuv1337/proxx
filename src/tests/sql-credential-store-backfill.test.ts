import assert from "node:assert/strict";
import test from "node:test";

import { SqlCredentialStore } from "../lib/db/sql-credential-store.js";

function makeJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${header}.${body}.sig`;
}

test("backfills missing OpenAI OAuth email metadata from stored JWT tokens", async () => {
  const accessToken = makeJwt({
    sub: "user_123",
    email: "backfill@example.com",
    "https://api.openai.com/auth": {
      chatgpt_account_id: "workspace-123",
      chatgpt_plan_type: "pro",
    },
  });

  const providerRows = [{ id: "openai", auth_type: "oauth_bearer" }];
  type AccountRowFixture = {
    id: string;
    provider_id: string;
    token: string;
    refresh_token: string | null;
    expires_at: number | null;
    chatgpt_account_id: string | null;
    plan_type: string | null;
    email: string | null;
    subject: string | null;
  };

  const accountRows: AccountRowFixture[] = [
    {
      id: "openai-a",
      provider_id: "openai",
      token: accessToken,
      refresh_token: "refresh-token",
      expires_at: null,
      chatgpt_account_id: null,
      plan_type: null,
      email: null,
      subject: null,
    },
  ];

  const writes: Array<readonly unknown[]> = [];
  type MockSql = {
    unsafe: (query: unknown, params?: readonly unknown[]) => Promise<unknown>;
    begin: (fn: (tx: MockSql) => Promise<unknown>) => Promise<unknown>;
  };

  const sql: MockSql = {
    unsafe: async (query: unknown, params?: readonly unknown[]) => {
      const statement = String(query);

      if (/SELECT\s+id,\s+auth_type[\s\S]*FROM providers/i.test(statement)) {
        return providerRows;
      }

      if (/SELECT\s+id,\s+provider_id[\s\S]*FROM accounts/i.test(statement)) {
        return accountRows;
      }

      if (statement.includes("INSERT INTO accounts")) {
        if (params) {
          writes.push(params);
          const [id, providerId, token, refreshToken, expiresAt, chatgptAccountId, planType, email, subject] = params;
          accountRows[0] = {
            id: String(id),
            provider_id: String(providerId),
            token: String(token),
            refresh_token: typeof refreshToken === "string" ? refreshToken : null,
            expires_at: typeof expiresAt === "number" ? expiresAt : null,
            chatgpt_account_id: typeof chatgptAccountId === "string" ? chatgptAccountId : null,
            plan_type: typeof planType === "string" ? planType : null,
            email: typeof email === "string" ? email : null,
            subject: typeof subject === "string" ? subject : null,
          };
        }

        return [];
      }

      return [];
    },
    begin: async (fn: (tx: MockSql) => Promise<unknown>) => fn(sql),
  };

  const store = new SqlCredentialStore(sql as never, { defaultTenantId: "tenant-default" });
  await store.init();

  assert.equal(writes.length, 1);
  assert.equal(writes[0]?.[7], "backfill@example.com");
  assert.equal(writes[0]?.[8], "user_123");

  const providers = await store.listProviders(false);
  assert.equal(providers.length, 1);
  assert.equal(providers[0]?.id, "openai");
  assert.equal(providers[0]?.accounts[0]?.email, "backfill@example.com");
  assert.equal(providers[0]?.accounts[0]?.subject, "user_123");
  assert.equal(providers[0]?.accounts[0]?.planType, "pro");
  assert.equal(providers[0]?.accounts[0]?.chatgptAccountId, "workspace-123");
});
