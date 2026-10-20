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

  constructor(
    private readonly usersRepository: UsersRepository,
    private readonly source: CatalogAccountSource,
    private readonly catalog: Catalog,
  ) {}

  async list(): Promise<UserCatalogAccount[]> {
    const [users, linked] = await Promise.all([this.usersRepository.list(), this.source.listAccounts()]);

    const matched = await Promise.all(
      linked.map(async (account): Promise<UserCatalogAccount | null> => {
        const user = users.find((candidate) => candidate.jellyfinId === account.playerAccountId);
        const credentials = user ? await this.freshCredentials(user, account) : null;
        return user && credentials ? { user, account: { userRef: user.id, credentials } } : null;
      }),
    );
    const usable = matched.filter((account): account is UserCatalogAccount => account !== null);
    CatalogAccountsService.logger.debug(
      `${usable.length} users matched out of ${users.length} (${linked.length} linked catalog accounts)`,
    );
    return usable;
  }

  /** Null when the user must link the account again; the current credentials when renewal merely failed. */
  private async freshCredentials(user: UserEntity, { playerAccountId, credentials }: LinkedCatalogAccount) {
    try {
      return (await this.renew(playerAccountId, credentials)) ?? credentials;
    } catch (error) {
      if (error instanceof CatalogAccountRevokedError) {
        CatalogAccountsService.logger.warn(`User ${user.name}: ${error.message}`);
        return null;
      }
      CatalogAccountsService.logger.warn(`User ${user.name}: credential renewal failed (${describeError(error)})`);
      return credentials;
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
