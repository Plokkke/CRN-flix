import { Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { Catalog, MetadataSource, Player } from '@crn-flix/contracts';
import { JellyfinLayout } from '@crn-flix/layout-jellyfin';

import { Config } from '@/app.module';
import { CATALOG } from '@/providers/catalog';
import { METADATA } from '@/providers/media-titles';
import { PLAYER } from '@/providers/player';
import { LibraryTitlesRepository, ShelfOverridesRepository } from '@/services/database/library';
import { MediasRepository } from '@/services/database/medias';
import { PolicyExemptionsRepository } from '@/services/database/policy';
import { UsersRepository } from '@/services/database/users';
import { LibraryAccess } from '@/services/library/access';
import { BundledShelfImages } from '@/services/library/images';
import { ManualDestinations } from '@/services/library/manual-destination';
import { LibraryPaths } from '@/services/library/paths';
import { PolicyShelfResolver } from '@/services/library/resolver';
import { SeasonRemapService } from '@/services/library/season-remap';
import { LibraryShelves } from '@/services/library/shelves';
import { PlayerAccountsService } from '@/services/player-accounts';
import { PolicyAnomalies } from '@/services/policy/anomaly';
import { PolicyService } from '@/services/policy/policy';

export const libraryProviders: Provider[] = [
  {
    provide: SeasonRemapService,
    inject: [LibraryPaths, LibraryTitlesRepository, CATALOG, METADATA, MediasRepository, PLAYER],
    useFactory: (
      paths: LibraryPaths,
      titles: LibraryTitlesRepository,
      catalog: Catalog,
      metadata: MetadataSource,
      medias: MediasRepository,
      player: Player,
    ): SeasonRemapService =>
      new SeasonRemapService(paths, titles, catalog, metadata, medias, new JellyfinLayout(), player),
  },
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
      new LibraryAccess(configService.get('library'), paths, undefined, new BundledShelfImages()),
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
    inject: [
      LibraryPaths,
      LibraryTitlesRepository,
      PolicyShelfResolver,
      PLAYER,
      PlayerAccountsService,
      PolicyAnomalies,
    ],
    useFactory: (
      paths: LibraryPaths,
      titles: LibraryTitlesRepository,
      resolver: PolicyShelfResolver,
      player: Player,
      accounts: PlayerAccountsService,
      anomalies: PolicyAnomalies,
    ): LibraryShelves => {
      const shelves = new LibraryShelves(paths, titles, resolver, player, () => accounts.applyAll(), anomalies);
      anomalies.wire({ reconcile: () => shelves.reconcile(), discard: (imdbId) => shelves.discard(imdbId) });
      return shelves;
    },
  },
  {
    provide: ManualDestinations,
    inject: [
      ConfigService,
      ShelfOverridesRepository,
      PolicyExemptionsRepository,
      UsersRepository,
      PolicyService,
      LibraryShelves,
    ],
    useFactory: (
      configService: ConfigService<Config, true>,
      overrides: ShelfOverridesRepository,
      exemptions: PolicyExemptionsRepository,
      users: UsersRepository,
      policy: PolicyService,
      shelves: LibraryShelves,
    ): ManualDestinations => new ManualDestinations(overrides, exemptions, users, policy, shelves),
  },
];
