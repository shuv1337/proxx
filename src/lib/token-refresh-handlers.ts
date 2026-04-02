import type { ProviderCredential } from "./key-pool.js";
import type { RuntimeCredentialStore } from "./runtime-credential-store.js";
import type { OpenAiOAuthManager, OAuthTokens } from "./openai-oauth.js";
import { isTerminalOpenAiRefreshError } from "./openai-oauth.js";
import { refreshFactoryOAuthToken, parseJwtExpiry, persistFactoryAuthV2 } from "./factory-auth.js";
import { toErrorMessage } from "./provider-utils.js";

export interface TokenRefreshDeps {
  readonly keyPool: {
    updateAccountCredential(providerId: string, oldCredential: ProviderCredential, newCredential: ProviderCredential): void;
    markRateLimited(credential: ProviderCredential, retryAfterMs?: number): void;
    getExpiredAccountsWithRefreshTokens(providerId: string): ProviderCredential[];
    getAllAccounts(providerId: string): Promise<ProviderCredential[]>;
  };
  readonly runtimeCredentialStore: RuntimeCredentialStore;
  readonly oauthManager: OpenAiOAuthManager;
  readonly sqlCredentialStore?: unknown;
  readonly log: { info(obj: Record<string, unknown>, msg: string): void; warn(obj: Record<string, unknown>, msg: string): void };
}

export interface TokenRefreshHandlers {
  readonly refreshExpiredOAuthAccount: (credential: ProviderCredential) => Promise<ProviderCredential | null>;
  readonly ensureFreshAccounts: (providerId: string) => Promise<void>;
}

export function createTokenRefreshHandlers(deps: TokenRefreshDeps): TokenRefreshHandlers {
  const { keyPool, runtimeCredentialStore, oauthManager, log, sqlCredentialStore } = deps;

  async function refreshOpenAiCredential(credential: ProviderCredential): Promise<ProviderCredential | null> {
    if (!credential.refreshToken) {
      return null;
    }

    if (credential.providerId === "factory") {
      return refreshFactoryAccount(credential);
    }

    log.info({ accountId: credential.accountId, providerId: credential.providerId }, "refreshing expired OAuth token");

    let newTokens: OAuthTokens;
    try {
      newTokens = await oauthManager.refreshToken(credential.refreshToken);
    } catch (error) {
      if (isTerminalOpenAiRefreshError(error)) {
        const disabledCredential: ProviderCredential = {
          ...credential,
          refreshToken: undefined,
        };

        keyPool.updateAccountCredential(credential.providerId, credential, disabledCredential);
        if (typeof credential.expiresAt === "number" && credential.expiresAt <= Date.now()) {
          keyPool.markRateLimited(disabledCredential, 24 * 60 * 60 * 1000);
        }

        await runtimeCredentialStore.upsertOAuthAccount(
          credential.providerId,
          disabledCredential.accountId,
          disabledCredential.token,
          undefined,
          disabledCredential.expiresAt,
          disabledCredential.chatgptAccountId,
          undefined,
          undefined,
          disabledCredential.planType,
        );

        log.warn({
          accountId: credential.accountId,
          providerId: credential.providerId,
          code: (error as { code?: string }).code,
          status: (error as { status?: number }).status,
        }, "disabled terminally invalid OpenAI refresh token; full reauth required");
      }

      throw error;
    }

    const newCredential: ProviderCredential = {
      providerId: credential.providerId,
      accountId: newTokens.accountId,
      token: newTokens.accessToken,
      authType: "oauth_bearer",
      chatgptAccountId: newTokens.chatgptAccountId ?? credential.chatgptAccountId,
      planType: newTokens.planType,
      refreshToken: newTokens.refreshToken ?? credential.refreshToken,
      expiresAt: newTokens.expiresAt,
    };

    keyPool.updateAccountCredential(credential.providerId, credential, newCredential);

    await runtimeCredentialStore.upsertOAuthAccount(
      credential.providerId,
      newCredential.accountId,
      newCredential.token,
      newCredential.refreshToken,
      newCredential.expiresAt,
      newCredential.chatgptAccountId,
      newTokens.email,
      newTokens.subject,
      newTokens.planType,
    );

    log.info({
      accountId: newCredential.accountId,
      providerId: newCredential.providerId,
      expiresAt: newCredential.expiresAt,
    }, "OAuth token refreshed successfully");

    return newCredential;
  }

  async function refreshFactoryAccount(credential: ProviderCredential): Promise<ProviderCredential | null> {
    if (!credential.refreshToken) {
      return null;
    }

    try {
      log.info({ accountId: credential.accountId, providerId: "factory" }, "refreshing Factory OAuth token via WorkOS");

      const refreshed = await refreshFactoryOAuthToken(credential.refreshToken);
      const expiresAt = refreshed.expiresAt ?? parseJwtExpiry(refreshed.accessToken) ?? undefined;

      const newCredential: ProviderCredential = {
        providerId: "factory",
        accountId: credential.accountId,
        token: refreshed.accessToken,
        authType: "oauth_bearer",
        refreshToken: refreshed.refreshToken,
        expiresAt,
      };

      keyPool.updateAccountCredential("factory", credential, newCredential);

      await runtimeCredentialStore.upsertOAuthAccount(
        "factory",
        newCredential.accountId,
        newCredential.token,
        newCredential.refreshToken,
        newCredential.expiresAt,
      );

      if (!sqlCredentialStore) {
        try {
          await persistFactoryAuthV2(refreshed.accessToken, refreshed.refreshToken);
        } catch {
          // Expected to fail on read-only container filesystems; DB has the data.
        }
      }

      log.info({
        accountId: newCredential.accountId,
        providerId: "factory",
        expiresAt: newCredential.expiresAt,
      }, "Factory OAuth token refreshed successfully");

      return newCredential;
    } catch (error) {
      log.warn({
        error: toErrorMessage(error),
        accountId: credential.accountId,
        providerId: "factory",
      }, "failed to refresh Factory OAuth token");
      return null;
    }
  }

  async function refreshExpiredOAuthAccount(credential: ProviderCredential): Promise<ProviderCredential | null> {
    return refreshOpenAiCredential(credential);
  }

  async function ensureFreshAccounts(providerId: string): Promise<void> {
    const expiredAccounts = keyPool.getExpiredAccountsWithRefreshTokens(providerId);

    if (expiredAccounts.length > 0) {
      for (const account of expiredAccounts) {
        await refreshOpenAiCredential(account);
      }
    }

    if (providerId === "factory") {
      const allFactoryAccounts = await keyPool.getAllAccounts("factory").catch(() => [] as ProviderCredential[]);
      for (const account of allFactoryAccounts) {
        if (factoryCredentialNeedsRefresh(account)) {
          await refreshOpenAiCredential(account);
        }
      }
    }
  }

  return { refreshExpiredOAuthAccount, ensureFreshAccounts };
}

function factoryCredentialNeedsRefresh(credential: ProviderCredential): boolean {
  if (!credential.refreshToken) {
    return false;
  }
  if (typeof credential.expiresAt !== "number") {
    return false;
  }
  const thirtyMinutesMs = 30 * 60 * 1000;
  return credential.expiresAt - Date.now() < thirtyMinutesMs;
}
