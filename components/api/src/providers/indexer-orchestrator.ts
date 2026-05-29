import { ConfigService } from '@nestjs/config';

import { Config } from '@/app.module';
import { Indexer, INDEXERS } from '@/modules/indexer/contract';
import { RequestsRepository } from '@/services/database/requests';
import { FetchrSyncService } from '@/services/fetchr-sync';
import { IndexerOrchestrator } from '@/services/indexer-orchestrator';

export const indexersRegistryProvider = {
  provide: INDEXERS,
  useValue: [] as Indexer[],
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
