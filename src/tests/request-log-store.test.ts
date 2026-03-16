import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { RequestLogStore } from "../lib/request-log-store.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

async function withTempDir(fn: (tempDir: string) => Promise<void>): Promise<void> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "request-log-store-test-"));

  try {
    await fn(tempDir);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

test("warmup quarantines a corrupted request log file and starts empty", async () => {
  await withTempDir(async (tempDir) => {
    const filePath = path.join(tempDir, "request-logs.json");
    const corruptJson = `{
  "entries": [
    {
      "id": "entry-1",
      "timestamp": 1773701127508,
      "providerId": "openai",
      "accountId": "acct-1",
      "authType": "api_key",
      "model": "gpt-5.4",
      "upstreamMode": "responses",
      "upstreamPath": "/v1/responses",
      "status": 200,
      "latencyMs": 125,
      "pro`;

    await writeFile(filePath, corruptJson, "utf8");

    const store = new RequestLogStore(filePath, 100);
    await store.warmup();

    assert.deepEqual(store.snapshot(), []);

    const rewrittenContents = await readFile(filePath, "utf8");
    const rewrittenDb: unknown = JSON.parse(rewrittenContents);
    assert.ok(isRecord(rewrittenDb));
    assert.deepEqual(rewrittenDb.entries, []);
    assert.deepEqual(rewrittenDb.hourlyBuckets, []);
    assert.deepEqual(rewrittenDb.accountAccumulators, []);

    const files = await readdir(tempDir);
    const corruptFileName = files.find((file) => file.startsWith("request-logs.json.corrupt-"));
    assert.ok(corruptFileName);
    assert.equal(await readFile(path.join(tempDir, corruptFileName), "utf8"), corruptJson);

    await store.close();
  });
});

test("request log persistence reloads cleanly without leaving temp files behind", async () => {
  await withTempDir(async (tempDir) => {
    const filePath = path.join(tempDir, "request-logs.json");
    const store = new RequestLogStore(filePath, 100);
    await store.warmup();

    store.record({
      providerId: "openai",
      accountId: "acct-1",
      authType: "api_key",
      model: "gpt-5.4",
      upstreamMode: "responses",
      upstreamPath: "/v1/responses",
      status: 200,
      latencyMs: 125,
      promptTokens: 12,
      completionTokens: 8,
      totalTokens: 20,
    });

    await store.close();

    const files = await readdir(tempDir);
    assert.equal(files.some((file) => file.endsWith(".tmp")), false);

    const reloaded = new RequestLogStore(filePath, 100);
    await reloaded.warmup();

    const entries = reloaded.snapshot();
    assert.equal(entries.length, 1);
    assert.equal(entries[0]?.providerId, "openai");
    assert.equal(entries[0]?.accountId, "acct-1");
    assert.equal(entries[0]?.model, "gpt-5.4");
    assert.equal(entries[0]?.totalTokens, 20);

    await reloaded.close();
  });
});
