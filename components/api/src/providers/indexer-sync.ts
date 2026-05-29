import { RequestsRepository } from '@/services/database/requests';
import { IndexerOrchestrator } from '@/services/indexer-orchestrator';
import { IndexerSyncService } from '@/services/indexer-sync';

export const indexerSyncProvider = {
  provide: IndexerSyncService,
  inject: [RequestsRepository, IndexerOrchestrator],
  useFactory: (requestsRepository: RequestsRepository, orchestrator: IndexerOrchestrator): IndexerSyncService => {
    return new IndexerSyncService(requestsRepository, orchestrator);
  },
};
