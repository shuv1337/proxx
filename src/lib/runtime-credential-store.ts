import { CredentialStore, type CredentialProviderView, type CredentialStoreLike } from "./credential-store.js";
import { SqlCredentialStore } from "./db/sql-credential-store.js";

export class RuntimeCredentialStore implements CredentialStoreLike {
  public constructor(
    private readonly fileStore: CredentialStore,
    private readonly sqlStore?: SqlCredentialStore,
  ) {}

  public async listProviders(revealSecrets: boolean): Promise<CredentialProviderView[]> {
    if (!this.sqlStore) {
      return this.fileStore.listProviders(revealSecrets);
    }

    return this.sqlStore.listProviders(revealSecrets);
  }

  public async upsertApiKeyAccount(providerId: string, accountId: string, apiKey: string): Promise<void> {
    if (this.sqlStore) {
      await this.sqlStore.upsertApiKeyAccount(providerId, accountId, apiKey);
      return;
    }

    await this.fileStore.upsertApiKeyAccount(providerId, accountId, apiKey);
  }

  public async upsertOAuthAccount(
    providerId: string,
    accountId: string,
    accessToken: string,
    refreshToken?: string,
    expiresAt?: number,
    chatgptAccountId?: string,
  ): Promise<void> {
    if (this.sqlStore) {
      await this.sqlStore.upsertOAuthAccount(
        providerId,
        accountId,
        accessToken,
        refreshToken,
        expiresAt,
        chatgptAccountId,
      );
      return;
    }

    await this.fileStore.upsertOAuthAccount(
      providerId,
      accountId,
      accessToken,
      refreshToken,
      expiresAt,
      chatgptAccountId,
    );
  }

  public async removeAccount(providerId: string, accountId: string): Promise<boolean> {
    let removed = false;

    if (this.sqlStore) {
      removed = await this.sqlStore.removeAccount(providerId, accountId);
    }

    try {
      const fileRemoved = await this.fileStore.removeAccount(providerId, accountId);
      removed = removed || fileRemoved;
    } catch {
      // file store removal is best-effort
    }

    return removed;
  }
}
