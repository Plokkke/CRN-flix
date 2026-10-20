import { Provider } from '@nestjs/common';

import { Player } from '@crn-flix/contracts';
import { JellyfinMediaService, JellyfinPlayer } from '@crn-flix/player-jellyfin';

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
    inject: [RequestsRepository, MediasRepository, PLAYER],
    useFactory: (requests: RequestsRepository, medias: MediasRepository, player: Player): PlayerSyncService =>
      new PlayerSyncService(requests, medias, player),
  },
  {
    provide: PlayerAccountsService,
    inject: [UsersRepository, PLAYER],
    useFactory: (users: UsersRepository, player: Player): PlayerAccountsService =>
      new PlayerAccountsService(users, player),
  },
];
