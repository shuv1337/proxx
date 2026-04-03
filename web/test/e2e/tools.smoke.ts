import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";

import { chromium } from "playwright";

const BASE_URL = "http://127.0.0.1:5174";

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForServer(url: string, timeoutMs: number): Promise<boolean> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url, { method: "GET" });
      if (response.ok) {
        return true;
      }
    } catch {
      // keep waiting
    }
    await sleep(500);
  }
  return false;
}

async function ensureFrontendServer(): Promise<{ child: ChildProcess | null }> {
  if (await waitForServer(BASE_URL, 2_000)) {
    return { child: null };
  }

  const child = spawn("pnpm", ["web:dev"], {
    cwd: "/home/err/devel/orgs/open-hax/proxx",
    stdio: "ignore",
    detached: false,
  });

  const ready = await waitForServer(BASE_URL, 30_000);
  if (!ready) {
    child.kill("SIGTERM");
    throw new Error("Frontend dev server did not become ready on http://127.0.0.1:5174");
  }

  return { child };
}

async function main(): Promise<void> {
  const { child } = await ensureFrontendServer();

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  await page.route("**/api/v1/settings", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ fastMode: false }),
    });
  });

  await page.route("**/api/v1/tools?*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        tools: [
          { id: "apply_patch", description: "Patch files safely", enabled: true },
          { id: "bash", description: "Run shell commands", enabled: true },
        ],
      }),
    });
  });

  await page.route("**/api/v1/mcp-servers", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        servers: [
          {
            id: "social-publisher",
            script: "node ./server.js",
            cwd: "/workspace/mcp-social-publisher",
            args: [],
            port: 8799,
            sourceFile: "ecosystem.container.config.cjs",
            running: false,
          },
        ],
      }),
    });
  });

  try {
    await page.goto(`${BASE_URL}/tools`, { waitUntil: "networkidle" });

    await page.getByRole("heading", { name: /Tool Manager/i }).waitFor();

    const content = await page.textContent("body");
    assert.ok(content?.includes("apply_patch"));
    assert.ok(content?.includes("Patch files safely"));
    assert.ok(content?.includes("MCP Manager"));
    assert.ok(content?.includes("social-publisher"));
  } finally {
    await page.close();
    await browser.close();
    if (child) {
      child.kill("SIGTERM");
    }
  }
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
