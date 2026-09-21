import { ConfigService } from '@nestjs/config';

import { Config } from '@/app.module';
import { Indexer, INDEXERS } from '@/modules/indexer/contract';
import { createIndexers } from '@/modules/indexer/registry';
import { TraktPlugin } from '@/modules/jellyfin/plugins/trakt';
import { TraktApi } from '@/modules/trakt/api';
import { MemoryCacheService } from '@/services/cache/memory-cache.service';
import { IndexerBookmarksRepository } from '@/services/database/indexer-bookmarks';
import { PlannedDownloadsRepository } from '@/services/database/planned-downloads';
import { PlannerFindingsRepository } from '@/services/database/planner-findings';
import { RequestStatesRepository } from '@/services/database/request-states';
import { RequestsRepository } from '@/services/database/requests';
import { UsersRepository } from '@/services/database/users';
import { FetchrSyncService } from '@/services/fetchr-sync';
import { MediaTitlesService } from '@/services/media-titles';
import { PlannerService } from '@/services/planner/planner';
import { TraktPlayheadService } from '@/services/trakt-playhead';

export const indexersRegistryProvider = {
  provide: INDEXERS,
  inject: [ConfigService],
  useFactory: (configService: ConfigService<Config, true>): Indexer[] => {
    const { loadix } = configService.get('indexer', { infer: true });
    return createIndexers({ loadix }, configService.get('name'));
  },
};

export const traktPlayheadProvider = {
  provide: TraktPlayheadService,
  inject: [UsersRepository, TraktPlugin, TraktApi],
  useFactory: (users: UsersRepository, traktPlugin: TraktPlugin, traktClient: TraktApi): TraktPlayheadService =>
    new TraktPlayheadService(users, traktPlugin, traktClient),
};

export const plannerProvider = {
  provide: PlannerService,
  inject: [
    ConfigService,
    INDEXERS,
    RequestsRepository,
    PlannedDownloadsRepository,
    TraktPlayheadService,
    FetchrSyncService,
    MemoryCacheService,
    IndexerBookmarksRepository,
    RequestStatesRepository,
    PlannerFindingsRepository,
    MediaTitlesService,
  ],
  useFactory: (
    configService: ConfigService<Config, true>,
    indexers: Indexer[],
    requests: RequestsRepository,
    plannedDownloads: PlannedDownloadsRepository,
    playheads: TraktPlayheadService,
    fetchr: FetchrSyncService,
    cache: MemoryCacheService,
    bookmarks: IndexerBookmarksRepository,
    states: RequestStatesRepository,
    findings: PlannerFindingsRepository,
    mediaTitles: MediaTitlesService,
  ): PlannerService => {
    const { needWindowHours, maxWindowHours } = configService.get('sync', { infer: true });
    const { preferences } = configService.get('indexer', { infer: true });
    return new PlannerService(
      { needWindowHours, maxWindowHours },
      indexers,
      preferences,
      requests,
      plannedDownloads,
      playheads,
      fetchr,
      cache,
      bookmarks,
      states,
      findings,
      mediaTitles,
    );
  },
};
