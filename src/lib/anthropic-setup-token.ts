import { randomBytes } from "node:crypto";

import { getTelemetry } from "./telemetry/otel.js";

// ─── Constants ───────────────────────────────────────────────────────────────

/**
 * Anthropic setup-token prefix, matching OpenClaw's validation heuristics.
 * See: https://github.com/openclaw/openclaw/blob/main/src/commands/auth-token.ts
 */
export const ANTHROPIC_SETUP_TOKEN_PREFIX = "sk-ant-oat01-";

/**
 * Minimum length for a valid Anthropic setup-token, matching OpenClaw.
 */
export const ANTHROPIC_SETUP_TOKEN_MIN_LENGTH = 80;

// ─── Validation ──────────────────────────────────────────────────────────────

/**
 * Validate a raw Anthropic setup-token string.
 *
 * Returns a human-readable error message if the token is invalid,
 * or `undefined` if the token passes heuristic validation.
 *
 * This is intentionally heuristic-only — it does not call Anthropic to verify
 * the token. The goal is to catch obvious mistakes (wrong prefix, too short,
 * blank input) without pretending to cryptographically verify the token.
 */
export function validateAnthropicSetupToken(raw: string): string | undefined {
  const trimmed = raw.trim();

  if (trimmed.length === 0) {
    return "Setup token is required.";
  }

  if (!trimmed.startsWith(ANTHROPIC_SETUP_TOKEN_PREFIX)) {
    return `Setup token must start with "${ANTHROPIC_SETUP_TOKEN_PREFIX}".`;
  }

  if (trimmed.length < ANTHROPIC_SETUP_TOKEN_MIN_LENGTH) {
    return `Setup token is too short (minimum ${ANTHROPIC_SETUP_TOKEN_MIN_LENGTH} characters).`;
  }

  return undefined;
}

// ─── Account ID generation ───────────────────────────────────────────────────

/**
 * Generate a collision-resistant fallback account ID for setup-token accounts.
 *
 * Pattern: `claude-setup-<8-char-random-hex>`
 *
 * Uses random hex instead of timestamps to avoid collisions when multiple
 * tokens are added in rapid succession.
 */
export function generateSetupTokenAccountId(): string {
  return `claude-setup-${randomBytes(4).toString("hex")}`;
}

// ─── Telemetry helpers ───────────────────────────────────────────────────────

export function logSetupTokenValidationFailure(error: string): void {
  getTelemetry().recordLog("warn", "anthropic.setup_token.validation_failed", {
    "validation.error": error,
  });
}

export function logSetupTokenSaved(providerId: string, accountId: string): void {
  getTelemetry().recordLog("info", "anthropic.setup_token.saved", {
    providerId,
    accountId,
  });
}

export function logSetupTokenSaveRejected(reason: string): void {
  getTelemetry().recordLog("warn", "anthropic.setup_token.save_rejected", {
    reason,
  });
}
