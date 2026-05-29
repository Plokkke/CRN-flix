import { ConfigService } from '@nestjs/config';

import { Config } from '@/app.module';
import { TraktPlugin } from '@/modules/jellyfin/plugins/trakt';
import { TraktApi } from '@/modules/trakt/api';
import { MediasRepository } from '@/services/database/medias';
import { RequestsRepository } from '@/services/database/requests';
import { UserActivitiesRepository } from '@/services/database/user-activities';
import { UsersRepository } from '@/services/database/users';
import { IndexerOrchestrator } from '@/services/indexer-orchestrator';
import { TraktSyncService } from '@/services/trakt-sync';

export const traktSyncProvider = {
  provide: TraktSyncService,
  inject: [
    ConfigService,
    TraktPlugin,
    TraktApi,
    UsersRepository,
    UserActivitiesRepository,
    MediasRepository,
    RequestsRepository,
    IndexerOrchestrator,
  ],
  useFactory: (
    configService: ConfigService<Config, true>,
    traktPlugin: TraktPlugin,
    traktApi: TraktApi,
    usersRepository: UsersRepository,
    userActivitySyncsRepository: UserActivitiesRepository,
    mediasRepository: MediasRepository,
    requestsRepository: RequestsRepository,
    indexerOrchestrator: IndexerOrchestrator,
  ): TraktSyncService => {
    return new TraktSyncService(
      configService.get('sync'),
      traktPlugin,
      traktApi,
      usersRepository,
      userActivitySyncsRepository,
      mediasRepository,
      requestsRepository,
      indexerOrchestrator,
    );
  },
};
