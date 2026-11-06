import { Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { Player } from '@crn-flix/contracts';

import { Config } from '@/app.module';
import { PLAYER } from '@/providers/player';
import { LibraryTitlesRepository, ShelfOverridesRepository } from '@/services/database/library';
import { PolicyExemptionsRepository } from '@/services/database/policy';
import { UsersRepository } from '@/services/database/users';
import { LibraryAccess } from '@/services/library/access';
import { LibraryPaths } from '@/services/library/paths';
import { PolicyShelfResolver } from '@/services/library/resolver';
import { LibraryShelves } from '@/services/library/shelves';
import { PlayerAccountsService } from '@/services/player-accounts';
import { PolicyService } from '@/services/policy/policy';

export const libraryProviders: Provider[] = [
  {
    provide: LibraryPaths,
    inject: [ConfigService],
    useFactory: (configService: ConfigService<Config, true>): LibraryPaths =>
      new LibraryPaths(configService.get('library')),
  },
  {
    provide: LibraryAccess,
    inject: [ConfigService, LibraryPaths],
    useFactory: (configService: ConfigService<Config, true>, paths: LibraryPaths): LibraryAccess =>
      new LibraryAccess(configService.get('library'), paths),
  },
  {
    provide: PolicyShelfResolver,
    inject: [PolicyService, PolicyExemptionsRepository, ShelfOverridesRepository, UsersRepository],
    useFactory: (
      policy: PolicyService,
      exemptions: PolicyExemptionsRepository,
      overrides: ShelfOverridesRepository,
      users: UsersRepository,
    ): PolicyShelfResolver => new PolicyShelfResolver(policy, exemptions, overrides, users),
  },
  {
    provide: LibraryShelves,
    inject: [LibraryPaths, LibraryTitlesRepository, PolicyShelfResolver, PLAYER, PlayerAccountsService],
    useFactory: (
      paths: LibraryPaths,
      titles: LibraryTitlesRepository,
      resolver: PolicyShelfResolver,
      player: Player,
      accounts: PlayerAccountsService,
    ): LibraryShelves => new LibraryShelves(paths, titles, resolver, player, () => accounts.applyAll()),
  },
];
