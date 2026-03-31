import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const testDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(testDir, "..", "..");

test("big ussy bootstrap script keeps repaired local-core relay contract", async () => {
  const scriptPath = resolve(repoRoot, "..", "..", "services", "proxx", "bin", "project-complete-devel-stack-to-big-ussy.sh");
  const script = await readFile(scriptPath, "utf8");

  assert.match(script, /REMOTE_RELAY_PORT="18790"/);
  assert.match(script, /'id': 'local-core'/);
  assert.match(script, /'baseUrl': f'http:\/\/host\.docker\.internal:\$\{REMOTE_RELAY_PORT\}'/);
  assert.match(script, /'controlBaseUrl': f'http:\/\/host\.docker\.internal:\$\{REMOTE_RELAY_PORT\}'/);
  assert.doesNotMatch(script, /PROXX_CANON_SYNC_PEER_ID=local-canonical/);
  assert.match(script, /PROXX_CANON_SYNC_PEER_ID=local-core/);
  assert.match(script, /start_new_session=True/);
  assert.match(script, /stdin=subprocess\.DEVNULL/);
});
