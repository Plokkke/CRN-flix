import { ConfigService } from '@nestjs/config';

import { Config } from '@/app.module';
import { JellyfinMediaService } from '@/modules/jellyfin/jellyfin';
import { TraktPlugin } from '@/modules/jellyfin/plugins/trakt';
import { TraktApi } from '@/modules/trakt/api';
import { MediasRepository } from '@/services/database/medias';
import { RequestsRepository } from '@/services/database/requests';
import { UserActivitiesRepository } from '@/services/database/user-activities';
import { UsersRepository } from '@/services/database/users';
import { SyncService } from '@/services/sync';

export const syncProvider = {
  provide: SyncService,
  inject: [
    ConfigService,
    JellyfinMediaService,
    TraktPlugin,
    TraktApi,
    UsersRepository,
    UserActivitiesRepository,
    MediasRepository,
    RequestsRepository,
  ],
  useFactory: (
    configService: ConfigService<Config, true>,
    jellyfinMediaService: JellyfinMediaService,
    traktPlugin: TraktPlugin,
    traktApi: TraktApi,
    usersRepository: UsersRepository,
    userActivitySyncsRepository: UserActivitiesRepository,
    mediasRepository: MediasRepository,
    requestsRepository: RequestsRepository,
  ): SyncService => {
    return new SyncService(
      configService.get('sync'),
      jellyfinMediaService,
      traktPlugin,
      traktApi,
      usersRepository,
      userActivitySyncsRepository,
      mediasRepository,
      requestsRepository,
    );
  },
};
