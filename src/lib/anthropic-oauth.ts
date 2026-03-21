import { createHash } from "node:crypto";

import { getTelemetry } from "./telemetry/otel.js";

// ─── Constants ───────────────────────────────────────────────────────────────

const DEFAULT_CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
const DEFAULT_ISSUER = "https://platform.claude.com";
const DEFAULT_SCOPES =
  "org:create_api_key user:profile user:inference user:sessions:claude_code user:mcp_servers user:file_upload";

/**
 * The authorization endpoint lives on claude.ai (consumer Max plan flow).
 * This is fixed — it is not derived from the issuer.
 */
const AUTHORIZE_URL = "https://claude.ai/oauth/authorize";

/**
 * Redirect URI for the OAuth flow.
 * pi-mono uses a localhost callback server on port 53692; for the proxx
 * browser-based UI we still use a code-paste UX, but the redirect_uri
 * sent to Anthropic must match what was used during authorization.
 */
const OAUTH_REDIRECT_URI = "http://localhost:53692/callback";

// ─── Public types ─────────────────────────────────────────────────────────────

export interface AnthropicOAuthTokens {
  readonly accessToken: string;
  readonly refreshToken?: string;
  readonly expiresAt?: number;
  readonly accountId: string;
  readonly email?: string;
  readonly subject?: string;
  readonly planType?: string;
}

/**
 * Returned by `startCodeFlow`. Keep `verifier` — it is required for the
 * subsequent `exchangeCode` call.
 */
export interface AnthropicCodeFlowStartResponse {
  /** The URL to open in the user's browser. */
  readonly authorizeUrl: string;
  /** PKCE verifier — pass this to `exchangeCode` along with the user-pasted code. */
  readonly verifier: string;
}

export interface AnthropicOAuthManagerOptions {
  readonly fetchFn?: typeof fetch;
  readonly now?: () => number;
  /** OAuth client ID. Defaults to the public Anthropic client ID. */
  readonly clientId?: string;
  /**
   * Issuer base URL used for the token endpoint.
   * Defaults to `https://platform.claude.com`.
   */
  readonly issuer?: string;
  /** OAuth scopes. Defaults to the full Claude Code scope set. */
  readonly oauthScopes?: string;
}

// ─── Internal types ───────────────────────────────────────────────────────────

interface PkceCodes {
  readonly verifier: string;
  readonly challenge: string;
}

interface AnthropicTokenResponse {
  readonly access_token: string;
  readonly refresh_token?: string;
  readonly id_token?: string;
  readonly expires_in?: number;
  readonly token_type?: string;
}

interface AnthropicJwtClaims {
  readonly sub?: string;
  readonly email?: string;
  readonly plan_type?: string;
}

// ─── PKCE helpers ─────────────────────────────────────────────────────────────

function generateRandomString(length: number): string {
  const alphabet =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes)
    .map((value) => alphabet[value % alphabet.length])
    .join("");
}

function base64UrlEncode(buffer: ArrayBuffer): string {
  const bytes = Buffer.from(new Uint8Array(buffer));
  return bytes
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function generatePkce(): Promise<PkceCodes> {
  const verifier = generateRandomString(43);
  const hash = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(verifier),
  );
  return {
    verifier,
    challenge: base64UrlEncode(hash),
  };
}

// ─── JWT helpers ──────────────────────────────────────────────────────────────

function parseJwtClaims(token: string): AnthropicJwtClaims | undefined {
  const parts = token.split(".");
  if (parts.length !== 3) {
    return undefined;
  }

  try {
    return JSON.parse(
      Buffer.from(parts[1], "base64url").toString("utf8"),
    ) as AnthropicJwtClaims;
  } catch {
    return undefined;
  }
}

// ─── Account identity helpers ─────────────────────────────────────────────────

function subjectFromClaims(
  claims: AnthropicJwtClaims | undefined,
): string | undefined {
  const subject = claims?.sub?.trim();
  return subject && subject.length > 0 ? subject : undefined;
}

function emailFromClaims(
  claims: AnthropicJwtClaims | undefined,
): string | undefined {
  const email = claims?.email?.trim().toLowerCase();
  return email && email.length > 0 ? email : undefined;
}

function planTypeFromClaims(
  claims: AnthropicJwtClaims | undefined,
): string | undefined {
  const plan = claims?.plan_type?.trim();
  return plan && plan.length > 0 ? plan : undefined;
}

/**
 * Derive a stable account ID from Anthropic JWT claims.
 *
 * Priority:
 *  1. `sub` claim  → `anthropic-{sub}`
 *  2. `email` claim → `anthropic-{sha256(email).slice(0, 16)}`
 *  3. Fallback     → `anthropic-{timestamp}`
 */
function accountIdFromClaims(
  claims: AnthropicJwtClaims | undefined,
  now: () => number,
): string {
  const subject = subjectFromClaims(claims);
  if (subject) {
    return `anthropic-${subject}`;
  }

  const email = emailFromClaims(claims);
  if (email) {
    const digest = createHash("sha256")
      .update(email)
      .digest("hex")
      .slice(0, 16);
    return `anthropic-${digest}`;
  }

  return `anthropic-${now()}`;
}

function extractAccountIdentity(
  tokens: AnthropicTokenResponse,
  now: () => number,
): {
  readonly accountId: string;
  readonly email?: string;
  readonly subject?: string;
} {
  const idTokenClaims = tokens.id_token
    ? parseJwtClaims(tokens.id_token)
    : undefined;
  const accessClaims = parseJwtClaims(tokens.access_token);

  const claims = idTokenClaims ?? accessClaims;

  return {
    accountId: accountIdFromClaims(claims, now),
    email: emailFromClaims(idTokenClaims) ?? emailFromClaims(accessClaims),
    subject:
      subjectFromClaims(idTokenClaims) ?? subjectFromClaims(accessClaims),
  };
}

function toAnthropicOAuthTokens(
  tokens: AnthropicTokenResponse,
  now: () => number,
): AnthropicOAuthTokens {
  const identity = extractAccountIdentity(tokens, now);

  const idTokenClaims = tokens.id_token
    ? parseJwtClaims(tokens.id_token)
    : undefined;
  const accessClaims = parseJwtClaims(tokens.access_token);
  const planType =
    planTypeFromClaims(idTokenClaims) ?? planTypeFromClaims(accessClaims);

  return {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresAt:
      typeof tokens.expires_in === "number"
        ? now() + tokens.expires_in * 1000
        : undefined,
    accountId: identity.accountId,
    email: identity.email,
    subject: identity.subject,
    planType,
  };
}

// ─── Input parsing ────────────────────────────────────────────────────────────

/**
 * Parse user-pasted authorization input.
 *
 * Users will typically paste one of:
 *  - A full redirect URL:  `http://localhost:53692/callback?code=XXX&state=YYY`
 *  - A code#state pair:    `XXX#YYY`
 *  - Query-param string:   `code=XXX&state=YYY`
 *  - Just the code:        `XXX`
 *
 * This mirrors the pi-mono `parseAuthorizationInput` exactly.
 */
function parseAuthorizationInput(input: string): { code?: string; state?: string } {
  const value = input.trim();
  if (!value) return {};

  // Try parsing as a full URL first
  try {
    const url = new URL(value);
    return {
      code: url.searchParams.get("code") ?? undefined,
      state: url.searchParams.get("state") ?? undefined,
    };
  } catch {
    // not a URL
  }

  // code#state format
  if (value.includes("#")) {
    const [code, state] = value.split("#", 2);
    return { code, state };
  }

  // query-param format: code=XXX&state=YYY
  if (value.includes("code=")) {
    const params = new URLSearchParams(value);
    return {
      code: params.get("code") ?? undefined,
      state: params.get("state") ?? undefined,
    };
  }

  // Plain code
  return { code: value };
}

// ─── Manager class ────────────────────────────────────────────────────────────

/**
 * AnthropicOAuthManager handles the Anthropic code-paste OAuth2+PKCE flow.
 *
 * In this flow the authorization server (`claude.ai`) redirects the user to
 * Anthropic's own callback URL (`console.anthropic.com/oauth/code/callback`).
 * The user sees the authorization code in their browser and pastes it back
 * into the client. Our server is never involved in the redirect.
 *
 * The PKCE verifier is reused as the OAuth `state` parameter (Anthropic's
 * own convention). The code returned by Anthropic may contain a `#` separator
 * — only the part before `#` is the real code; the part after is an opaque
 * state fragment forwarded to the token endpoint.
 */
export class AnthropicOAuthManager {
  private readonly fetchFn: typeof fetch;
  private readonly now: () => number;
  private readonly clientId: string;
  private readonly issuer: string;
  private readonly oauthScopes: string;

  public constructor(options: AnthropicOAuthManagerOptions = {}) {
    this.fetchFn = options.fetchFn ?? fetch;
    this.now = options.now ?? (() => Date.now());
    this.clientId =
      (options.clientId ?? DEFAULT_CLIENT_ID).trim() || DEFAULT_CLIENT_ID;
    this.issuer =
      (options.issuer ?? DEFAULT_ISSUER).trim() || DEFAULT_ISSUER;
    this.oauthScopes =
      (options.oauthScopes ?? DEFAULT_SCOPES).trim() || DEFAULT_SCOPES;
  }

  /**
   * Start the code-paste OAuth flow.
   *
   * Generates a PKCE pair, builds the authorization URL on `claude.ai`, and
   * returns both the URL (to open in the user's browser) and the verifier
   * (to pass to `exchangeCode` once the user has copied the code).
   *
   * Per Anthropic's convention the PKCE verifier is also used as the `state`
   * parameter.
   */
  public async startCodeFlow(): Promise<AnthropicCodeFlowStartResponse> {
    const span = getTelemetry().startSpan("anthropic_oauth.code_flow_start", {
      "oauth.issuer": this.issuer,
      "oauth.scopes": this.oauthScopes,
    });

    try {
      const pkce = await generatePkce();

      const url = new URL(AUTHORIZE_URL);
      url.searchParams.set("code", "true");
      url.searchParams.set("client_id", this.clientId);
      url.searchParams.set("response_type", "code");
      url.searchParams.set("redirect_uri", OAUTH_REDIRECT_URI);
      url.searchParams.set("scope", this.oauthScopes);
      url.searchParams.set("code_challenge", pkce.challenge);
      url.searchParams.set("code_challenge_method", "S256");
      // Anthropic reuses the PKCE verifier as the state parameter.
      url.searchParams.set("state", pkce.verifier);

      const authorizeUrl = url.toString();

      getTelemetry().recordLog("info", "anthropic_oauth: code flow started", {
        "oauth.issuer": this.issuer,
        "oauth.authorize_url_base": AUTHORIZE_URL,
      });

      span.setStatus("ok");
      span.end();

      return { authorizeUrl, verifier: pkce.verifier };
    } catch (error) {
      span.recordError(error);
      span.setStatus("error", "Failed to start code flow");
      span.end();

      getTelemetry().recordLog(
        "error",
        "anthropic_oauth: failed to start code flow",
        { "oauth.issuer": this.issuer, "error": String(error) },
      );

      throw error;
    }
  }

  /**
   * Exchange a user-pasted authorization input for tokens.
   *
   * The input may be:
   *  - A full redirect URL: `http://localhost:53692/callback?code=XXX&state=YYY`
   *  - A code#state pair: `XXX#YYY`
   *  - Query params: `code=XXX&state=YYY`
   *  - Just the code: `XXX`
   *
   * If the parsed state doesn't match the verifier, the exchange is rejected.
   */
  public async exchangeCode(
    rawInput: string,
    verifier: string,
  ): Promise<AnthropicOAuthTokens> {
    const span = getTelemetry().startSpan("anthropic_oauth.exchange_code", {
      "oauth.issuer": this.issuer,
    });

    try {
      const parsed = parseAuthorizationInput(rawInput);
      const authCode = parsed.code;
      if (!authCode) {
        throw new Error("Missing authorization code in input");
      }

      // If a state was parsed, verify it matches the verifier
      if (parsed.state && parsed.state !== verifier) {
        throw new Error("OAuth state mismatch");
      }

      const state = parsed.state ?? verifier;

      const body: Record<string, string> = {
        grant_type: "authorization_code",
        code: authCode,
        client_id: this.clientId,
        redirect_uri: OAUTH_REDIRECT_URI,
        code_verifier: verifier,
        state,
      };

      const response = await this.fetchFn(
        `${this.issuer}/v1/oauth/token`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );

      if (!response.ok) {
        throw new Error(
          `Anthropic code exchange failed with status ${response.status}`,
        );
      }

      const tokenResponse = (await response.json()) as AnthropicTokenResponse;
      const tokens = toAnthropicOAuthTokens(tokenResponse, this.now);

      getTelemetry().recordLog(
        "info",
        "anthropic_oauth: code exchanged successfully",
        {
          "oauth.issuer": this.issuer,
          "oauth.account_id": tokens.accountId,
        },
      );

      span.setAttribute("oauth.account_id", tokens.accountId);
      span.setStatus("ok");
      span.end();

      return tokens;
    } catch (error) {
      span.recordError(error);
      span.setStatus("error", "Code exchange failed");
      span.end();

      getTelemetry().recordLog(
        "error",
        "anthropic_oauth: code exchange failed",
        { "oauth.issuer": this.issuer, "error": String(error) },
      );

      throw error;
    }
  }

  /**
   * Refresh an existing access token using a refresh token.
   */
  public async refreshToken(
    refreshToken: string,
  ): Promise<AnthropicOAuthTokens> {
    const span = getTelemetry().startSpan("anthropic_oauth.token_refresh", {
      "oauth.issuer": this.issuer,
    });

    try {
      const response = await this.fetchFn(
        `${this.issuer}/v1/oauth/token`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            grant_type: "refresh_token",
            refresh_token: refreshToken,
            client_id: this.clientId,
          }),
        },
      );

      if (!response.ok) {
        throw new Error(
          `Anthropic token refresh failed with status ${response.status}`,
        );
      }

      const tokenResponse = (await response.json()) as AnthropicTokenResponse;
      const tokens = toAnthropicOAuthTokens(tokenResponse, this.now);

      getTelemetry().recordLog(
        "info",
        "anthropic_oauth: token refreshed successfully",
        {
          "oauth.issuer": this.issuer,
          "oauth.account_id": tokens.accountId,
        },
      );

      span.setAttribute("oauth.account_id", tokens.accountId);
      span.setStatus("ok");
      span.end();

      return tokens;
    } catch (error) {
      span.recordError(error);
      span.setStatus("error", "Token refresh failed");
      span.end();

      getTelemetry().recordLog(
        "error",
        "anthropic_oauth: token refresh failed",
        { "oauth.issuer": this.issuer, "error": String(error) },
      );

      throw error;
    }
  }

  /**
   * Return true if the token has expired (or will expire within `bufferMs`).
   *
   * If `expiresAt` is undefined the token is treated as non-expiring and this
   * method returns false.
   */
  public isTokenExpired(
    expiresAt: number | undefined,
    bufferMs: number = 60_000,
  ): boolean {
    if (typeof expiresAt !== "number") {
      return false;
    }
    return this.now() >= expiresAt - bufferMs;
  }
}
