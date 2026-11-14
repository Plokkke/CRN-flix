import { Logger } from '@nestjs/common';

import { CatalogAccountSource, Player, PlayerAccount } from '@crn-flix/contracts';

import { UserEntity, UsersRepository, UserStatus } from '@/services/database/users';
import { LibraryAccess } from '@/services/library/access';

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
    private readonly access: LibraryAccess | null = null,
  ) {}

  /** Viewing accounts the engine does not know (the player's administrators aside), to take in. */
  async listUnlinked(): Promise<PlayerAccount[]> {
    const [users, accounts] = await Promise.all([this.usersRepository.list(), this.player.listAccounts()]);
    const linked = new Set(users.flatMap((user) => (user.jellyfinId ? [user.jellyfinId] : [])));
    return accounts.filter((account) => !account.isAdministrator && !linked.has(account.id));
  }

  /**
   * Takes a player account in: an active user without catalog nor messaging, administered like
   * the others (profile, streams, personal shelf); its stream limit is adopted from the player.
   */
  async adopt(accountId: string): Promise<UserEntity> {
    const account = (await this.listUnlinked()).find((candidate) => candidate.id === accountId);
    if (!account) {
      throw new Error('Compte introuvable ou déjà rattaché');
    }
    if (await this.usersRepository.existsByName(account.name)) {
      throw new Error(`Le nom ${account.name} est déjà pris par un abonné`);
    }
    const user = await this.usersRepository.createFromPlayerAccount(account.name, account.id);
    await this.apply(user).catch((error: unknown) => {
      PlayerAccountsService.logger.warn(
        `Account ${user.name}: taken in, policy on the next pass (${describeError(error)})`,
      );
    });
    PlayerAccountsService.logger.log(`Player account ${account.name} taken in`);
    return user;
  }

  async applyAll(): Promise<void> {
    const [users, accounts] = await Promise.all([this.usersRepository.list(), this.player.listAccounts()]);
    const accountIds = accounts.map((account) => account.id);
    await this.ensureLibraries(users);
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
    const access = user && this.access ? await this.access.policyOf(user) : {};
    if (await this.player.applyAccountPolicy(accountId, { ...(maxStreams !== null && { maxStreams }), ...access })) {
      PlayerAccountsService.logger.log(`Account ${user?.name ?? accountId}: account policy applied`);
    }
  }

  /** The shelves' libraries must exist before accounts are given them. */
  private async ensureLibraries(users: UserEntity[]): Promise<void> {
    if (!this.access) {
      return;
    }
    const active = users.filter((user) => user.status === UserStatus.Active);
    const created = await this.player.ensureLibraries(await this.access.libraries(active));
    if (created > 0) {
      PlayerAccountsService.logger.log(`${created} shelf librar${created > 1 ? 'ies' : 'y'} created on the player`);
    }
  }

  /** Null for a player administrator: its stream limit is its own until one is set on /admin/users. */
  private async adoptMaxStreams(user: UserEntity, accountId: string): Promise<number | null> {
    const current = await this.player.accountMaxStreams(accountId);
    if (current !== null) {
      await this.usersRepository.setMaxStreams(user.id, current);
      PlayerAccountsService.logger.log(`User ${user.name}: stream limit adopted from the player (${current})`);
    }
    return current;
  }
}
