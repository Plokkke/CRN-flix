import { Logger } from '@nestjs/common';

import { CatalogAccount, CatalogAccountSource } from '@crn-flix/contracts';

import { type UserEntity, UsersRepository } from '@/services/database/users';

export type UserCatalogAccount = {
  user: UserEntity;
  account: CatalogAccount;
};

/** Ties the catalog credentials held by the account source to the engine's users, by player account. */
export class CatalogAccountsService {
  private static readonly logger = new Logger(CatalogAccountsService.name);

  constructor(
    private readonly usersRepository: UsersRepository,
    private readonly source: CatalogAccountSource,
  ) {}

  async list(): Promise<UserCatalogAccount[]> {
    const [users, linked] = await Promise.all([this.usersRepository.list(), this.source.listAccounts()]);

    const matched = linked.flatMap(({ playerAccountId, credentials }): UserCatalogAccount[] => {
      const user = users.find((candidate) => candidate.jellyfinId === playerAccountId);
      return user ? [{ user, account: { userRef: user.id, credentials } }] : [];
    });
    CatalogAccountsService.logger.debug(
      `${matched.length} users matched out of ${users.length} (${linked.length} linked catalog accounts)`,
    );
    return matched;
  }
}
