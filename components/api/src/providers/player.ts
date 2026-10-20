import { Provider } from '@nestjs/common';

import { CatalogAccountSource, Player } from '@crn-flix/contracts';
import { JellyfinMediaService, JellyfinPlayer } from '@crn-flix/player-jellyfin';

import { CATALOG_ACCOUNT_SOURCE } from '@/providers/catalog';
import { MediasRepository } from '@/services/database/medias';
import { RequestsRepository } from '@/services/database/requests';
import { UsersRepository } from '@/services/database/users';
import { PlayerAccountsService } from '@/services/player-accounts';
import { PlayerSyncService } from '@/services/player-sync';

export const PLAYER = Symbol('Player');

export const playerProviders: Provider[] = [
  {
    provide: PLAYER,
    inject: [JellyfinMediaService],
    useFactory: (jellyfin: JellyfinMediaService): Player => new JellyfinPlayer(jellyfin),
  },
  {
    provide: PlayerSyncService,
    inject: [RequestsRepository, MediasRepository, PLAYER, PlayerAccountsService],
    useFactory: (
      requests: RequestsRepository,
      medias: MediasRepository,
      player: Player,
      accounts: PlayerAccountsService,
    ): PlayerSyncService => new PlayerSyncService(requests, medias, player, accounts),
  },
  {
    provide: PlayerAccountsService,
    inject: [UsersRepository, PLAYER, CATALOG_ACCOUNT_SOURCE],
    useFactory: (
      users: UsersRepository,
      player: Player,
      catalogAccounts: CatalogAccountSource,
    ): PlayerAccountsService => new PlayerAccountsService(users, player, catalogAccounts),
  },
];
