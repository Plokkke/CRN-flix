import { Logger } from '@nestjs/common';

import { CatalogAccountSource, Player } from '@crn-flix/contracts';

import { UserEntity, UsersRepository, UserStatus } from '@/services/database/users';

const describeError = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/**
 * Keeps every viewing account on the service's rules, the engine's users and the player's
 * own accounts alike. The stream limit belongs to the user (a family shares one account):
 * the database is its source of truth, seeded once from what the player account already
 * allows so nobody loses a stream they had; accounts unknown to the database keep theirs.
 */
export class PlayerAccountsService {
  private static readonly logger = new Logger(PlayerAccountsService.name);

  constructor(
    private readonly usersRepository: UsersRepository,
    private readonly player: Player,
    private readonly catalogAccounts: CatalogAccountSource,
  ) {}

  async applyAll(): Promise<void> {
    const [users, accountIds] = await Promise.all([this.usersRepository.list(), this.player.listAccountIds()]);
    for (const accountId of accountIds) {
      const user = users.find(
        (candidate) => candidate.jellyfinId === accountId && candidate.status === UserStatus.Active,
      );
      await this.applyTo(accountId, user).catch((error: unknown) => {
        PlayerAccountsService.logger.warn(
          `Account ${user?.name ?? accountId}: account policy not applied (${describeError(error)})`,
        );
      });
    }
    const changed = await this.catalogAccounts.enforceSettings();
    if (changed > 0) {
      PlayerAccountsService.logger.log(`Catalog settings restored on ${changed} linked account(s)`);
    }
  }

  async apply(user: UserEntity): Promise<void> {
    if (user.jellyfinId) {
      await this.applyTo(user.jellyfinId, user);
    }
  }

  private async applyTo(accountId: string, user: UserEntity | undefined): Promise<void> {
    const maxStreams = user ? (user.maxStreams ?? (await this.adoptMaxStreams(user, accountId))) : undefined;
    if (maxStreams === null) {
      return;
    }
    if (await this.player.applyAccountPolicy(accountId, { maxStreams })) {
      PlayerAccountsService.logger.log(`Account ${user?.name ?? accountId}: account policy applied`);
    }
  }

  /** Null for an account the player's administrators manage themselves. */
  private async adoptMaxStreams(user: UserEntity, accountId: string): Promise<number | null> {
    const current = await this.player.accountMaxStreams(accountId);
    if (current !== null) {
      await this.usersRepository.setMaxStreams(user.id, current);
      PlayerAccountsService.logger.log(`User ${user.name}: stream limit adopted from the player (${current})`);
    }
    return current;
  }
}
