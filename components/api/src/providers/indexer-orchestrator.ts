import { ConfigService } from '@nestjs/config';

import { Config } from '@/app.module';
import { Indexer, INDEXERS } from '@/modules/indexer/contract';
import { createIndexers } from '@/modules/indexer/registry';
import { RequestsRepository } from '@/services/database/requests';
import { FetchrSyncService } from '@/services/fetchr-sync';
import { IndexerOrchestrator } from '@/services/indexer-orchestrator';

export const indexersRegistryProvider = {
  provide: INDEXERS,
  inject: [ConfigService],
  useFactory: (configService: ConfigService<Config, true>): Indexer[] => {
    const { hydracker, loadix } = configService.get('indexer', { infer: true });
    return createIndexers({ hydracker, loadix }, configService.get('name'));
  },
};

export const indexerOrchestratorProvider = {
  provide: IndexerOrchestrator,
  inject: [INDEXERS, FetchrSyncService, RequestsRepository, ConfigService],
  useFactory: (
    indexers: Indexer[],
    fetchr: FetchrSyncService,
    requests: RequestsRepository,
    configService: ConfigService<Config, true>,
  ): IndexerOrchestrator => {
    const { preferences } = configService.get('indexer', { infer: true });
    return new IndexerOrchestrator(indexers, fetchr, requests, preferences);
  },
};
