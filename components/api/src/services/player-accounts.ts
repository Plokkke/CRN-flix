import { Logger } from '@nestjs/common';

import { Player } from '@crn-flix/contracts';

import { UserEntity, UsersRepository, UserStatus } from '@/services/database/users';

const describeError = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/**
 * Keeps every viewing account on the service's rules. The stream limit belongs to the user
 * (a family shares one account): the database is its source of truth, seeded once from what
 * the player account already allows so nobody loses a stream they had.
 */
export class PlayerAccountsService {
  private static readonly logger = new Logger(PlayerAccountsService.name);

  constructor(
    private readonly usersRepository: UsersRepository,
    private readonly player: Player,
  ) {}

  async applyAll(): Promise<void> {
    const users = (await this.usersRepository.list()).filter(
      (user) => user.status === UserStatus.Active && user.jellyfinId,
    );
    for (const user of users) {
      await this.apply(user).catch((error: unknown) => {
        PlayerAccountsService.logger.warn(`User ${user.name}: account policy not applied (${describeError(error)})`);
      });
    }
  }

  async apply(user: UserEntity): Promise<void> {
    if (!user.jellyfinId) {
      return;
    }
    const maxStreams = user.maxStreams ?? (await this.adoptMaxStreams(user, user.jellyfinId));
    if (maxStreams === null) {
      return;
    }
    if (await this.player.applyAccountPolicy(user.jellyfinId, { maxStreams })) {
      PlayerAccountsService.logger.log(`User ${user.name}: account policy applied (${maxStreams} stream(s))`);
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
