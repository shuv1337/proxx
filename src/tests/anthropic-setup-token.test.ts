import assert from "node:assert/strict";
import test from "node:test";

import {
  ANTHROPIC_SETUP_TOKEN_MIN_LENGTH,
  ANTHROPIC_SETUP_TOKEN_PREFIX,
  generateSetupTokenAccountId,
  validateAnthropicSetupToken,
} from "../lib/anthropic-setup-token.js";

// ─── Validation ──────────────────────────────────────────────────────────────

test("valid setup-token passes validation", () => {
  // Real-format test token from the plan
  const token =
    "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";
  const error = validateAnthropicSetupToken(token);
  assert.equal(error, undefined, "valid token should pass validation");
});

test("valid setup-token with whitespace is trimmed and passes", () => {
  const token =
    "  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  ";
  const error = validateAnthropicSetupToken(token);
  assert.equal(error, undefined, "token with surrounding whitespace should pass");
});

test("blank input fails validation", () => {
  const error = validateAnthropicSetupToken("");
  assert.ok(error !== undefined, "blank input should fail");
  assert.ok(error.toLowerCase().includes("required"), `error should mention 'required', got: ${error}`);
});

test("whitespace-only input fails validation", () => {
  const error = validateAnthropicSetupToken("   ");
  assert.ok(error !== undefined, "whitespace-only should fail");
  assert.ok(error.toLowerCase().includes("required"), `error should mention 'required', got: ${error}`);
});

test("wrong prefix fails validation", () => {
  const error = validateAnthropicSetupToken("sk-wrong-prefix-abc123456789012345678901234567890123456789012345678901234567890123456789");
  assert.ok(error !== undefined, "wrong prefix should fail");
  assert.ok(error.includes(ANTHROPIC_SETUP_TOKEN_PREFIX), `error should mention expected prefix, got: ${error}`);
});

test("too-short token fails validation", () => {
  // Has correct prefix but is too short
  const token = "sk-ant-oat01-short";
  const error = validateAnthropicSetupToken(token);
  assert.ok(error !== undefined, "too-short token should fail");
  assert.ok(error.includes(String(ANTHROPIC_SETUP_TOKEN_MIN_LENGTH)), `error should mention minimum length, got: ${error}`);
});

test("token exactly at minimum length passes", () => {
  // Build a token that is exactly ANTHROPIC_SETUP_TOKEN_MIN_LENGTH chars
  const prefix = ANTHROPIC_SETUP_TOKEN_PREFIX;
  const paddingLength = ANTHROPIC_SETUP_TOKEN_MIN_LENGTH - prefix.length;
  const token = prefix + "a".repeat(paddingLength);
  assert.equal(token.length, ANTHROPIC_SETUP_TOKEN_MIN_LENGTH);
  const error = validateAnthropicSetupToken(token);
  assert.equal(error, undefined, "token at exact minimum length should pass");
});

test("token one char below minimum length fails", () => {
  const prefix = ANTHROPIC_SETUP_TOKEN_PREFIX;
  const paddingLength = ANTHROPIC_SETUP_TOKEN_MIN_LENGTH - prefix.length - 1;
  const token = prefix + "a".repeat(paddingLength);
  assert.equal(token.length, ANTHROPIC_SETUP_TOKEN_MIN_LENGTH - 1);
  const error = validateAnthropicSetupToken(token);
  assert.ok(error !== undefined, "token one char below minimum should fail");
});

// ─── Account ID generation ───────────────────────────────────────────────────

test("generateSetupTokenAccountId returns claude-setup- prefix with hex suffix", () => {
  const id = generateSetupTokenAccountId();
  assert.ok(id.startsWith("claude-setup-"), `account ID should start with 'claude-setup-', got: ${id}`);
  const hex = id.slice("claude-setup-".length);
  assert.equal(hex.length, 8, `hex suffix should be 8 chars, got: ${hex.length}`);
  assert.ok(/^[0-9a-f]+$/.test(hex), `hex suffix should be valid hex, got: ${hex}`);
});

test("generateSetupTokenAccountId produces unique IDs", () => {
  const ids = new Set<string>();
  for (let i = 0; i < 100; i++) {
    ids.add(generateSetupTokenAccountId());
  }
  assert.equal(ids.size, 100, "100 generated IDs should all be unique");
});
