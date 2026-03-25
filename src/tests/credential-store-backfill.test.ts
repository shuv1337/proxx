import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { CredentialStore } from "../lib/credential-store.js";

function makeJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${header}.${body}.sig`;
}

test("backfills missing OpenAI OAuth email metadata in the file-backed credential store", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "open-hax-credential-store-test-"));
  const filePath = path.join(tempDir, "keys.json");

  const accessToken = makeJwt({
    sub: "user_file",
    email: "file-backfill@example.com",
    "https://api.openai.com/auth": {
      chatgpt_account_id: "workspace-file",
      chatgpt_plan_type: "team",
    },
  });

  await writeFile(
    filePath,
    JSON.stringify({
      providers: {
        openai: {
          auth: "oauth_bearer",
          accounts: [
            {
              id: "openai-file",
              access_token: accessToken,
              refresh_token: "refresh-file",
              expires_at: Date.now() + 3_600_000,
            },
          ],
        },
      },
    }, null, 2),
    "utf8",
  );

  const store = new CredentialStore(filePath, "openai");
  try {
    const providers = await store.listProviders(false);
    assert.equal(providers[0]?.accounts[0]?.email, "file-backfill@example.com");
    assert.equal(providers[0]?.accounts[0]?.subject, "user_file");
    assert.equal(providers[0]?.accounts[0]?.chatgptAccountId, "workspace-file");
    assert.equal(providers[0]?.accounts[0]?.planType, "team");

    await store.flush();

    const persistedJson = JSON.parse(await readFile(filePath, "utf8")) as unknown;
    assert.ok(typeof persistedJson === "object" && persistedJson !== null);
    const providersJson = (persistedJson as Record<string, unknown>).providers as Record<string, unknown>;
    const openai = providersJson.openai as { readonly accounts?: Array<Record<string, unknown>> };
    const account = openai.accounts?.[0];
    assert.equal(account?.email, "file-backfill@example.com");
    assert.equal(account?.subject, "user_file");
    assert.equal(account?.chatgpt_account_id, "workspace-file");
    assert.equal(account?.plan_type, "team");
  } finally {
    store.dispose();
    await rm(tempDir, { recursive: true, force: true });
  }
});
