import { Logger } from '@nestjs/common';

import {
  Catalog,
  CatalogAccount,
  CatalogAccountRevokedError,
  CatalogAccountSource,
  LinkedCatalogAccount,
} from '@crn-flix/contracts';

import { type UserEntity, UsersRepository } from '@/services/database/users';

export type UserCatalogAccount = {
  user: UserEntity;
  account: CatalogAccount;
};

/** Told what each listing learnt about an account's health; must not throw nor block. */
export type CatalogAccountWatcher = {
  revoked(user: UserEntity): void;
  usable(user: UserEntity): void;
};

const NO_WATCHER: CatalogAccountWatcher = { revoked: () => undefined, usable: () => undefined };

/** `proven`: the credentials are known to work (still valid, or just renewed). */
type FreshCredentials = { credentials: unknown; proven: boolean };

const describeError = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/**
 * Ties the catalog credentials held by the account source to the engine's users, by player
 * account, and keeps them fresh: the player only renews a token when it acts for that user,
 * so the account of someone who stopped watching would otherwise expire.
 */
export class CatalogAccountsService {
  private static readonly logger = new Logger(CatalogAccountsService.name);

  /** One renewal per account at a time: the catalog revokes a refresh token once used. */
  private readonly renewals = new Map<string, Promise<unknown>>();
  /** Credentials the catalog refused to renew: never retried, only new ones (a new link) are. */
  private readonly refused = new Set<string>();

  constructor(
    private readonly usersRepository: UsersRepository,
    private readonly source: CatalogAccountSource,
    private readonly catalog: Catalog,
    private readonly watcher: CatalogAccountWatcher = NO_WATCHER,
  ) {}

  async list(): Promise<UserCatalogAccount[]> {
    const [users, linked] = await Promise.all([this.usersRepository.list(), this.source.listAccounts()]);

    const matched = await Promise.all(
      linked.map(async (account) => {
        const user = users.find((candidate) => candidate.jellyfinId === account.playerAccountId);
        const fresh = user ? await this.freshCredentials(user, account) : null;
        return user && fresh ? { user, fresh } : null;
      }),
    );
    const listed = matched.filter((entry) => entry !== null);
    listed.filter(({ fresh }) => fresh.proven).forEach(({ user }) => this.watcher.usable(user));
    const usable = listed.map(({ user, fresh }) => ({
      user,
      account: { userRef: user.id, credentials: fresh.credentials },
    }));
    CatalogAccountsService.logger.debug(
      `${usable.length} users matched out of ${users.length} (${linked.length} linked catalog accounts)`,
    );
    return usable;
  }

  /**
   * Null when the user must link the account again. A renewal that merely failed (catalog
   * down) keeps the current credentials without proving anything: the account's state is unknown.
   */
  private async freshCredentials(
    user: UserEntity,
    { playerAccountId, credentials }: LinkedCatalogAccount,
  ): Promise<FreshCredentials | null> {
    const key = JSON.stringify(credentials);
    if (this.refused.has(key)) {
      this.watcher.revoked(user);
      return null;
    }
    try {
      return { credentials: (await this.renew(playerAccountId, credentials)) ?? credentials, proven: true };
    } catch (error) {
      if (error instanceof CatalogAccountRevokedError) {
        this.refused.add(key);
        CatalogAccountsService.logger.warn(`User ${user.name}: ${error.message}`);
        this.watcher.revoked(user);
        return null;
      }
      CatalogAccountsService.logger.warn(`User ${user.name}: credential renewal failed (${describeError(error)})`);
      return { credentials, proven: false };
    }
  }

  private renew(playerAccountId: string, credentials: unknown): Promise<unknown> {
    const pending = this.renewals.get(playerAccountId);
    if (pending) {
      return pending;
    }
    const renewal = this.catalog
      .renewCredentials(credentials, new Date())
      .then(async (renewed) => {
        if (renewed) {
          await this.source.saveCredentials(playerAccountId, renewed);
          CatalogAccountsService.logger.log(`Catalog credentials renewed for player account ${playerAccountId}`);
        }
        return renewed;
      })
      .finally(() => this.renewals.delete(playerAccountId));
    this.renewals.set(playerAccountId, renewal);
    return renewal;
  }
}
