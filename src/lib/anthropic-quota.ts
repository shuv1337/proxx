import type { CredentialAccountView, CredentialStoreLike } from "./credential-store.js";
import { getTelemetry } from "./telemetry/otel.js";

// ─── Constants ───────────────────────────────────────────────────────────────

const ANTHROPIC_USAGE_URL = "https://api.anthropic.com/api/oauth/usage";
const ANTHROPIC_TOKEN_URL = "https://platform.claude.com/v1/oauth/token";
const ANTHROPIC_DEFAULT_VERSION = "2023-06-01";
const ANTHROPIC_DEFAULT_BETA = "oauth-2025-04-20";
const ANTHROPIC_REFRESH_BUFFER_MS = 60 * 1000;
const ANTHROPIC_USAGE_TIMEOUT_MS = 15_000;

/** Per-account success cache TTL: 5 minutes. */
const CACHE_TTL_MS = 5 * 60 * 1000;

/** Backoff: start at 60 s, double each 429, cap at 15 min. */
const BACKOFF_BASE_MS = 60 * 1000;
const BACKOFF_MAX_MS = 15 * 60 * 1000;

// ─── Provider-agnostic quota DTOs ────────────────────────────────────────────

export interface CredentialQuotaWindowSummary {
  readonly key: string;
  readonly label: string;
  readonly usedPercent: number | null;
  readonly remainingPercent: number | null;
  readonly resetsAt: string | null;
  readonly resetAfterSeconds: number | null;
}

export interface CredentialQuotaAccountSummary {
  readonly providerId: string;
  readonly accountId: string;
  readonly displayName: string;
  readonly email?: string;
  readonly planType?: string;
  readonly status: "ok" | "error";
  readonly fetchedAt: string;
  readonly stale?: boolean;
  readonly backoffUntil?: string;
  readonly windows: readonly CredentialQuotaWindowSummary[];
  readonly error?: string;
}

export interface AnthropicQuotaSnapshotResponse {
  readonly generatedAt: string;
  readonly accounts: readonly CredentialQuotaAccountSummary[];
}

// ─── Logger interface ─────────────────────────────────────────────────────────

interface LoggerLike {
  info?: (payload: unknown, message?: string) => void;
  warn?: (payload: unknown, message?: string) => void;
}

// ─── Module-level per-account state ──────────────────────────────────────────

interface CacheEntry {
  data: CredentialQuotaAccountSummary;
  expiresAt: number;
}

interface BackoffEntry {
  backoffUntilMs: number;
  consecutiveFailures: number;
}

const successCache = new Map<string, CacheEntry>();
const backoffState = new Map<string, BackoffEntry>();

// ─── Utility helpers ──────────────────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function cacheKey(providerId: string, accountId: string): string {
  return `${providerId}:${accountId}`;
}

// ─── Normalisation helpers (mirrors openai-quota.ts) ─────────────────────────

function normalizePercent(value: number): number {
  const normalized = value > 0 && value < 1 ? value * 100 : value;
  return Math.min(100, Math.max(0, normalized));
}

function normalizeResetsAt(
  resetsAt: string | undefined,
  resetAfterSeconds: number | undefined,
): string | null {
  if (resetsAt) {
    const parsed = new Date(resetsAt);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString();
    }
  }
  if (typeof resetAfterSeconds === "number" && Number.isFinite(resetAfterSeconds)) {
    return new Date(Date.now() + resetAfterSeconds * 1000).toISOString();
  }
  return null;
}

function normalizeResetAfterSeconds(
  resetsAt: string | undefined,
  resetAfterSeconds: number | undefined,
): number | null {
  if (typeof resetAfterSeconds === "number" && Number.isFinite(resetAfterSeconds)) {
    return Math.max(0, Math.round(resetAfterSeconds));
  }
  if (resetsAt) {
    const parsed = new Date(resetsAt);
    if (!Number.isNaN(parsed.getTime())) {
      return Math.max(0, Math.round((parsed.getTime() - Date.now()) / 1000));
    }
  }
  return null;
}

// ─── Quota window parsing ─────────────────────────────────────────────────────

interface ParsedWindow {
  usedPercent: number | null;
  remainingPercent: number | null;
  resetsAt: string | null;
  resetAfterSeconds: number | null;
}

function parseQuotaWindow(value: unknown): ParsedWindow | null {
  if (!isRecord(value)) {
    return null;
  }

  const rawUsedPercent =
    asNumber(value.used_percent) ??
    asNumber(value.usedPercent) ??
    asNumber(value.percent_used) ??
    asNumber(value.percentUsed) ??
    asNumber(value.utilization);

  const rawRemainingPercent =
    asNumber(value.remaining_percent) ??
    asNumber(value.remainingPercent) ??
    asNumber(value.percent_remaining) ??
    asNumber(value.percentRemaining);

  const usedUnits =
    asNumber(value.used) ??
    asNumber(value.used_units) ??
    asNumber(value.usedUnits) ??
    asNumber(value.used_tokens) ??
    asNumber(value.usedTokens) ??
    asNumber(value.input_tokens) ??
    asNumber(value.tokens_used);

  const remainingUnits =
    asNumber(value.remaining) ??
    asNumber(value.remaining_units) ??
    asNumber(value.remainingUnits) ??
    asNumber(value.remaining_tokens) ??
    asNumber(value.remainingTokens);

  const limitUnits =
    asNumber(value.limit) ??
    asNumber(value.quota) ??
    asNumber(value.total) ??
    asNumber(value.max) ??
    asNumber(value.maximum) ??
    asNumber(value.token_limit) ??
    asNumber(value.limit_tokens);

  const rawResetsAt =
    asString(value.resets_at) ??
    asString(value.resetsAt) ??
    asString(value.reset_at) ??
    asString(value.resetAt) ??
    asString(value.reset) ??
    asString(value.end_time) ??
    asString(value.period_end);

  const rawResetAfterSeconds =
    asNumber(value.reset_after_seconds) ?? asNumber(value.resetAfterSeconds);

  let usedPercent =
    typeof rawUsedPercent === "number" ? normalizePercent(rawUsedPercent) : null;
  let remainingPercent =
    typeof rawRemainingPercent === "number" ? normalizePercent(rawRemainingPercent) : null;

  if (remainingPercent === null && usedPercent !== null) {
    remainingPercent = Math.max(0, 100 - usedPercent);
  }
  if (usedPercent === null && remainingPercent !== null) {
    usedPercent = Math.max(0, 100 - remainingPercent);
  }

  if (
    (usedPercent === null || remainingPercent === null) &&
    typeof limitUnits === "number" &&
    limitUnits > 0
  ) {
    if (usedPercent === null && typeof usedUnits === "number") {
      usedPercent = normalizePercent((usedUnits / limitUnits) * 100);
    }
    if (remainingPercent === null && typeof remainingUnits === "number") {
      remainingPercent = normalizePercent((remainingUnits / limitUnits) * 100);
    }
    // Derive remaining from used if limit is known
    if (
      remainingPercent === null &&
      usedPercent !== null
    ) {
      remainingPercent = Math.max(0, 100 - usedPercent);
    }
    if (usedPercent === null && remainingPercent !== null) {
      usedPercent = Math.max(0, 100 - remainingPercent);
    }
  }

  const resetsAt = normalizeResetsAt(rawResetsAt, rawResetAfterSeconds);
  const resetAfterSeconds = normalizeResetAfterSeconds(rawResetsAt, rawResetAfterSeconds);

  if (
    usedPercent === null &&
    remainingPercent === null &&
    !resetsAt &&
    resetAfterSeconds === null
  ) {
    return null;
  }

  return { usedPercent, remainingPercent, resetsAt, resetAfterSeconds };
}

// ─── Anthropic response parsing ───────────────────────────────────────────────

/**
 * Extracts per-window quota summaries from the Anthropic usage API response.
 *
 * The Anthropic usage API response may take several shapes. We try to handle:
 *
 *   1. `{ data: [ { period: "daily"|"monthly", ... }, ... ] }` – list form.
 *   2. `{ usage: { daily: { ... }, monthly: { ... } } }` – nested form.
 *   3. `{ daily: { ... }, monthly: { ... } }` – flat top-level form.
 *   4. A single window object at the top level.
 */
function extractQuotaWindows(payload: unknown): CredentialQuotaWindowSummary[] {
  if (!isRecord(payload)) {
    return [];
  }

  const windows: CredentialQuotaWindowSummary[] = [];

  // Form 1: list of period entries
  const dataArray = Array.isArray(payload.data) ? payload.data : undefined;
  if (dataArray && dataArray.length > 0) {
    for (const entry of dataArray) {
      if (!isRecord(entry)) continue;

      const period = asString(entry.period)?.trim().toLowerCase() ?? "";
      const key = period || "window";
      const label = capitalizeFirst(period) || "Usage Window";

      // Each entry may embed usage/limit directly or in sub-objects
      const usageObj = isRecord(entry.usage) ? entry.usage : entry;
      const limitObj = isRecord(entry.limit) ? entry.limit : undefined;

      // Merge limit fields into usageObj candidate for parseQuotaWindow
      const candidate: Record<string, unknown> = { ...usageObj };
      if (limitObj) {
        // Pull limit tokens/units from the limit sub-object
        const limitValue =
          asNumber(limitObj.tokens) ??
          asNumber(limitObj.units) ??
          asNumber(limitObj.total) ??
          asNumber(limitObj.value);
        if (typeof limitValue === "number") {
          candidate.limit = limitValue;
        }
      }

      // Also propagate reset/period end from the outer entry
      if (!candidate.resets_at && !candidate.reset_at) {
        const resetsAt =
          asString(entry.resets_at) ??
          asString(entry.end_time) ??
          asString(entry.period_end);
        if (resetsAt) {
          candidate.resets_at = resetsAt;
        }
      }

      const parsed = parseQuotaWindow(candidate);
      if (parsed) {
        windows.push({ key, label, ...parsed });
      }
    }

    if (windows.length > 0) {
      return windows;
    }
  }

  // Form 2 & 3: nested { usage: { daily, monthly } } or flat { daily, monthly }
  const usageRoot = isRecord(payload.usage) ? payload.usage : payload;

  const candidates: Array<{ key: string; label: string; raw: unknown }> = [
    { key: "five_hour", label: "Rolling 5h", raw: usageRoot.five_hour ?? usageRoot.fiveHour },
    { key: "seven_day", label: "Weekly", raw: usageRoot.seven_day ?? usageRoot.sevenDay },
    { key: "seven_day_sonnet", label: "Weekly (Sonnet)", raw: usageRoot.seven_day_sonnet },
    { key: "seven_day_opus", label: "Weekly (Opus)", raw: usageRoot.seven_day_opus },
    { key: "daily", label: "Daily", raw: usageRoot.daily },
    { key: "monthly", label: "Monthly", raw: usageRoot.monthly },
    { key: "weekly", label: "Weekly", raw: usageRoot.weekly },
    { key: "hourly", label: "Hourly", raw: usageRoot.hourly },
  ];

  for (const { key, label, raw } of candidates) {
    if (raw === undefined || raw === null) continue;
    const parsed = parseQuotaWindow(raw);
    if (parsed) {
      windows.push({ key, label, ...parsed });
    }
  }

  if (windows.length > 0) {
    return windows;
  }

  // Form 4: single top-level window
  const topLevel = parseQuotaWindow(usageRoot);
  if (topLevel) {
    windows.push({ key: "usage", label: "Usage", ...topLevel });
  }

  return windows;
}

function extractPlanType(payload: unknown, fallback?: string): string | undefined {
  if (!isRecord(payload)) return fallback;
  const root = isRecord(payload.usage) ? payload.usage : payload;
  const plan =
    asString(root.plan_type) ??
    asString(root.planType) ??
    asString(root.tier) ??
    asString(root.subscription_tier) ??
    asString((payload as Record<string, unknown>).plan_type);
  const normalized = plan?.trim().toLowerCase();
  return normalized && normalized.length > 0 ? normalized : fallback;
}

function capitalizeFirst(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ─── Error message helpers ────────────────────────────────────────────────────

function quotaErrorMessage(responseStatus: number, responseText: string): string {
  const trimmed = responseText.trim();
  if (trimmed.length === 0) {
    return `HTTP ${responseStatus}`;
  }
  try {
    const parsed = JSON.parse(trimmed);
    if (isRecord(parsed)) {
      const errObj = isRecord(parsed.error) ? parsed.error : undefined;
      const message =
        asString(errObj?.message) ??
        asString(parsed.message) ??
        asString(parsed.detail);
      if (message && message.trim().length > 0) {
        return message.trim();
      }
    }
  } catch {
    // Fall through to plain text.
  }
  return trimmed.length > 160 ? `${trimmed.slice(0, 157)}...` : trimmed;
}

/**
 * Detect whether a quota error response is likely caused by a missing OAuth scope,
 * common for Claude setup-token credentials that lack `user:profile` scope.
 */
function isProbableScopeError(responseStatus: number, responseText: string): boolean {
  if (responseStatus !== 403) {
    return false;
  }
  const lower = responseText.toLowerCase();
  return (
    lower.includes("scope") ||
    lower.includes("user:profile") ||
    lower.includes("permission") ||
    lower.includes("insufficient")
  );
}

// ─── Token refresh ────────────────────────────────────────────────────────────

interface RefreshedAnthropicTokens {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly expiresAt?: number;
}

async function refreshAnthropicToken(
  refreshToken: string,
  fetchFn: typeof fetch,
): Promise<RefreshedAnthropicTokens | null> {
  try {
    const response = await fetchFn(ANTHROPIC_TOKEN_URL, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      }).toString(),
    });

    if (!response.ok) {
      return null;
    }

    const payload: unknown = await response.json();
    if (!isRecord(payload)) {
      return null;
    }

    const accessToken = asString(payload.access_token)?.trim();
    const nextRefreshToken =
      asString(payload.refresh_token)?.trim() ?? refreshToken;
    const expiresIn = asNumber(payload.expires_in);

    if (!accessToken) {
      return null;
    }

    return {
      accessToken,
      refreshToken: nextRefreshToken,
      expiresAt:
        typeof expiresIn === "number"
          ? Date.now() + expiresIn * 1000
          : undefined,
    };
  } catch {
    return null;
  }
}

function accountNeedsRefresh(account: CredentialAccountView): boolean {
  if (account.authType !== "oauth_bearer") {
    return false;
  }
  if (typeof account.expiresAt !== "number") {
    return false;
  }
  return account.expiresAt <= Date.now() + ANTHROPIC_REFRESH_BUFFER_MS;
}

async function ensureFreshAccount(
  providerId: string,
  account: CredentialAccountView,
  credentialStore: CredentialStoreLike,
  fetchFn: typeof fetch,
  logger?: LoggerLike,
): Promise<CredentialAccountView> {
  if (!accountNeedsRefresh(account)) {
    return account;
  }

  const refreshToken = account.refreshToken?.trim();
  if (!refreshToken) {
    return account;
  }

  getTelemetry().recordLog("info", "anthropic.quota.token_refresh.attempt", {
    providerId,
    accountId: account.id,
  });

  const refreshed = await refreshAnthropicToken(refreshToken, fetchFn);
  if (!refreshed) {
    logger?.warn?.(
      { providerId, accountId: account.id },
      "failed to refresh Anthropic quota token",
    );
    getTelemetry().recordLog("warn", "anthropic.quota.token_refresh.failed", {
      providerId,
      accountId: account.id,
    });
    return account;
  }

  const nextAccount: CredentialAccountView = {
    ...account,
    secret: refreshed.accessToken,
    refreshToken: refreshed.refreshToken,
    expiresAt: refreshed.expiresAt,
  };

  await credentialStore.upsertOAuthAccount(
    providerId,
    nextAccount.id,
    refreshed.accessToken,
    refreshed.refreshToken,
    refreshed.expiresAt,
    nextAccount.chatgptAccountId,
    nextAccount.email,
    nextAccount.subject,
    nextAccount.planType,
  );

  await credentialStore.flush?.();

  logger?.info?.(
    { providerId, accountId: account.id },
    "refreshed Anthropic quota token",
  );
  getTelemetry().recordLog("info", "anthropic.quota.token_refresh.success", {
    providerId,
    accountId: account.id,
  });

  return nextAccount;
}

// ─── Backoff helpers ──────────────────────────────────────────────────────────

function isBackedOff(key: string): boolean {
  const entry = backoffState.get(key);
  if (!entry) return false;
  return Date.now() < entry.backoffUntilMs;
}

function recordBackoff(key: string): void {
  const existing = backoffState.get(key);
  const failures = (existing?.consecutiveFailures ?? 0) + 1;
  const delayMs = Math.min(BACKOFF_BASE_MS * Math.pow(2, failures - 1), BACKOFF_MAX_MS);
  backoffState.set(key, {
    backoffUntilMs: Date.now() + delayMs,
    consecutiveFailures: failures,
  });
}

function clearBackoff(key: string): void {
  backoffState.delete(key);
}

function backoffUntilIso(key: string): string | undefined {
  const entry = backoffState.get(key);
  if (!entry || Date.now() >= entry.backoffUntilMs) return undefined;
  return new Date(entry.backoffUntilMs).toISOString();
}

// ─── Cache helpers ────────────────────────────────────────────────────────────

function getCached(key: string): CredentialQuotaAccountSummary | null {
  const entry = successCache.get(key);
  if (!entry) return null;
  if (Date.now() >= entry.expiresAt) {
    successCache.delete(key);
    return null;
  }
  return entry.data;
}

function setCached(key: string, data: CredentialQuotaAccountSummary): void {
  successCache.set(key, { data, expiresAt: Date.now() + CACHE_TTL_MS });
}

/**
 * Constructs a new summary from `base`, overriding presentation-only fields.
 * Using an explicit builder rather than object spread avoids TypeScript control-flow
 * narrowing issues inside try blocks.
 */
function withOverrides(
  base: CredentialQuotaAccountSummary,
  overrides: {
    fetchedAt: string;
    stale?: boolean;
    backoffUntil?: string;
  },
): CredentialQuotaAccountSummary {
  return {
    providerId: base.providerId,
    accountId: base.accountId,
    displayName: base.displayName,
    email: base.email,
    planType: base.planType,
    status: base.status,
    fetchedAt: overrides.fetchedAt,
    stale: overrides.stale,
    backoffUntil: overrides.backoffUntil,
    windows: base.windows,
    error: base.error,
  };
}

// ─── Core per-account fetch ───────────────────────────────────────────────────

async function fetchQuotaForAccount(
  providerId: string,
  account: CredentialAccountView,
  credentialStore: CredentialStoreLike,
  fetchFn: typeof fetch,
  betaHeader: string | undefined,
  anthropicVersion: string,
  logger?: LoggerLike,
): Promise<CredentialQuotaAccountSummary> {
  const fetchedAt = new Date().toISOString();
  const key = cacheKey(providerId, account.id);
  const telemetry = getTelemetry();

  // ── Check cache ────────────────────────────────────────────────────────────
  const cached = getCached(key);

  // ── Check backoff ──────────────────────────────────────────────────────────
  if (isBackedOff(key)) {
    const backoffUntil = backoffUntilIso(key);
    telemetry.recordLog("warn", "anthropic.quota.backoff.applied", {
      providerId,
      accountId: account.id,
      backoffUntil: backoffUntil ?? null,
    });
    logger?.warn?.(
      { providerId, accountId: account.id, backoffUntil },
      "Anthropic quota fetch skipped: backoff active",
    );

    if (cached !== null) {
      return withOverrides(cached, { stale: true, backoffUntil, fetchedAt });
    }

    return {
      providerId,
      accountId: account.id,
      displayName: account.displayName,
      email: account.email,
      planType: account.planType,
      status: "error",
      fetchedAt,
      stale: false,
      backoffUntil,
      windows: [],
      error: "Rate-limited by Anthropic; backoff active",
    };
  }

  // ── Cache hit ──────────────────────────────────────────────────────────────
  if (cached !== null) {
    telemetry.recordLog("info", "anthropic.quota.cache.hit", {
      providerId,
      accountId: account.id,
    });
    logger?.info?.(
      { providerId, accountId: account.id },
      "Anthropic quota cache hit",
    );
    return withOverrides(cached, { stale: false, fetchedAt });
  }

  telemetry.recordLog("info", "anthropic.quota.cache.miss", {
    providerId,
    accountId: account.id,
  });

  // ── Fetch ──────────────────────────────────────────────────────────────────
  const span = telemetry.startSpan("anthropic.quota.fetch", {
    providerId,
    accountId: account.id,
  });

  try {
    const freshAccount = await ensureFreshAccount(
      providerId,
      account,
      credentialStore,
      fetchFn,
      logger,
    );

    const accessToken = freshAccount.secret?.trim();
    if (!accessToken) {
      span.setStatus("error", "Missing access token");
      span.end();
      return {
        providerId,
        accountId: account.id,
        displayName: account.displayName,
        email: account.email,
        planType: account.planType,
        status: "error",
        fetchedAt,
        windows: [],
        error: "Missing access token",
      };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => {
      controller.abort();
    }, ANTHROPIC_USAGE_TIMEOUT_MS);

    let response: Response;
    try {
      const headers: Record<string, string> = {
        authorization: `Bearer ${accessToken}`,
        "anthropic-version": anthropicVersion,
        "content-type": "application/json",
        accept: "application/json",
      };
      if (betaHeader) {
        headers["anthropic-beta"] = betaHeader;
      }

      response = await fetchFn(ANTHROPIC_USAGE_URL, {
        method: "GET",
        headers,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      const responseText = await response.text().catch(() => "");

      // Handle 429 rate-limit with backoff
      if (response.status === 429) {
        recordBackoff(key);
        const backoffUntil = backoffUntilIso(key);
        telemetry.recordLog("warn", "anthropic.quota.rate_limited", {
          providerId,
          accountId: account.id,
          backoffUntil: backoffUntil ?? null,
        });
        logger?.warn?.(
          { providerId, accountId: account.id, backoffUntil },
          "Anthropic quota fetch rate-limited (429); backoff applied",
        );

        const errMessage = quotaErrorMessage(response.status, responseText);
        span.setStatus("error", errMessage);
        span.setAttribute("http.status_code", response.status);
        span.end();

        if (cached !== null) {
          return withOverrides(cached, { stale: true, backoffUntil, fetchedAt });
        }

        return {
          providerId,
          accountId: account.id,
          displayName: account.displayName,
          email: account.email,
          planType: account.planType,
          status: "error",
          fetchedAt,
          backoffUntil,
          windows: [],
          error: errMessage,
        };
      }

      const rawErrMessage = quotaErrorMessage(response.status, responseText);
      const scopeFailure = isProbableScopeError(response.status, responseText);
      const errMessage = scopeFailure
        ? "Quota unavailable — this token may lack the required scope. Inference can still work."
        : rawErrMessage;

      if (scopeFailure) {
        telemetry.recordLog("warn", "anthropic.quota.scope_failure", {
          providerId,
          accountId: account.id,
          httpStatus: response.status,
        });
      }

      span.setStatus("error", errMessage);
      span.setAttribute("http.status_code", response.status);
      span.end();

      logger?.warn?.(
        { providerId, accountId: account.id, status: response.status, error: errMessage, scopeFailure },
        "Anthropic quota fetch failed",
      );

      return {
        providerId,
        accountId: account.id,
        displayName: account.displayName,
        email: account.email,
        planType: account.planType,
        status: "error",
        fetchedAt,
        windows: [],
        error: errMessage,
      };
    }

    const payload: unknown = await response.json();

    const windows = extractQuotaWindows(payload);
    const planType = extractPlanType(payload, freshAccount.planType);

    if (planType && planType !== freshAccount.planType) {
      await credentialStore.upsertOAuthAccount(
        providerId,
        freshAccount.id,
        accessToken,
        freshAccount.refreshToken,
        freshAccount.expiresAt,
        freshAccount.chatgptAccountId,
        freshAccount.email,
        freshAccount.subject,
        planType,
      );
      await credentialStore.flush?.();
    }

    // Success: clear backoff and populate cache
    clearBackoff(key);

    const result: CredentialQuotaAccountSummary = {
      providerId,
      accountId: freshAccount.id,
      displayName: freshAccount.displayName,
      email: freshAccount.email,
      planType,
      status: "ok",
      fetchedAt,
      stale: false,
      windows,
    };

    setCached(key, result);

    span.setStatus("ok");
    span.setAttribute("windows_count", windows.length);
    span.end();

    telemetry.recordLog("info", "anthropic.quota.fetch.success", {
      providerId,
      accountId: account.id,
      windowsCount: windows.length,
    });

    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    span.recordError(error);
    span.end();

    logger?.warn?.(
      { providerId, accountId: account.id, error: message },
      "failed to fetch Anthropic quota usage",
    );
    telemetry.recordLog("warn", "anthropic.quota.fetch.error", {
      providerId,
      accountId: account.id,
      error: message,
    });

    return {
      providerId,
      accountId: account.id,
      displayName: account.displayName,
      email: account.email,
      planType: account.planType,
      status: "error",
      fetchedAt,
      windows: [],
      error: message,
    };
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function fetchAnthropicQuotaSnapshots(
  credentialStore: CredentialStoreLike,
  options: {
    readonly providerId?: string;
    readonly accountId?: string;
    readonly fetchFn?: typeof fetch;
    readonly logger?: LoggerLike;
    readonly betaHeader?: string;
    readonly anthropicVersion?: string;
  },
): Promise<AnthropicQuotaSnapshotResponse> {
  const fetchFn = options.fetchFn ?? fetch;
  const betaHeader = options.betaHeader ?? ANTHROPIC_DEFAULT_BETA;
  const anthropicVersion = options.anthropicVersion ?? ANTHROPIC_DEFAULT_VERSION;

  const providers = await credentialStore.listProviders(true);

  // If a specific providerId is given, look only at that provider;
  // otherwise collect all providers whose ID contains "anthropic".
  const matchingProviders =
    options.providerId !== undefined
      ? providers.filter((p) => p.id === options.providerId)
      : providers.filter((p) =>
          p.id.toLowerCase().includes("anthropic"),
        );

  const accounts = matchingProviders
    .flatMap((provider) =>
      provider.accounts.map((account) => ({
        provider,
        account,
      })),
    )
    .filter(
      ({ account }) =>
        !options.accountId || account.id === options.accountId,
    )
    .sort(({ account: left, provider: lp }, { account: right, provider: rp }) => {
      const leftLabel = (
        left.email ??
        left.displayName ??
        `${lp.id}:${left.id}`
      ).toLowerCase();
      const rightLabel = (
        right.email ??
        right.displayName ??
        `${rp.id}:${right.id}`
      ).toLowerCase();
      return leftLabel.localeCompare(rightLabel);
    });

  const snapshots = await Promise.all(
    accounts.map(({ provider, account }) =>
      fetchQuotaForAccount(
        provider.id,
        account,
        credentialStore,
        fetchFn,
        betaHeader,
        anthropicVersion,
        options.logger,
      ),
    ),
  );

  return {
    generatedAt: new Date().toISOString(),
    accounts: snapshots,
  };
}
