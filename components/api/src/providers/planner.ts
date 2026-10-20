import { ConfigService } from '@nestjs/config';

import { Indexer } from '@crn-flix/contracts';

import { Config } from '@/app.module';
import { createIndexers, INDEXERS } from '@/modules/indexer/registry';
import { MemoryCacheService } from '@/services/cache/memory-cache.service';
import { CatalogPlayheadService } from '@/services/catalog/playheads';
import { IndexerBookmarksRepository } from '@/services/database/indexer-bookmarks';
import { PlannedDownloadsRepository } from '@/services/database/planned-downloads';
import { PlannerFindingsRepository } from '@/services/database/planner-findings';
import { RequestStatesRepository } from '@/services/database/request-states';
import { RequestsRepository } from '@/services/database/requests';
import { FetchrSyncService } from '@/services/fetchr-sync';
import { MediaTitlesService } from '@/services/media-titles';
import { PlannerService } from '@/services/planner/planner';

export const indexersRegistryProvider = {
  provide: INDEXERS,
  inject: [ConfigService],
  useFactory: (configService: ConfigService<Config, true>): Indexer[] => {
    const { loadix } = configService.get('indexer', { infer: true });
    return createIndexers({ loadix }, configService.get('name'));
  },
};

export const plannerProvider = {
  provide: PlannerService,
  inject: [
    ConfigService,
    INDEXERS,
    RequestsRepository,
    PlannedDownloadsRepository,
    CatalogPlayheadService,
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
    playheads: CatalogPlayheadService,
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
