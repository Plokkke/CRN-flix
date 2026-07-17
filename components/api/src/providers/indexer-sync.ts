import { RequestsRepository } from '@/services/database/requests';
import { IndexerOrchestrator } from '@/services/indexer-orchestrator';
import { IndexerSyncService } from '@/services/indexer-sync';
import { DiscordAdminMessaging } from '@/services/messaging/admin/discord';

export const indexerSyncProvider = {
  provide: IndexerSyncService,
  inject: [RequestsRepository, IndexerOrchestrator, DiscordAdminMessaging],
  useFactory: (
    requestsRepository: RequestsRepository,
    orchestrator: IndexerOrchestrator,
    adminsMessaging: DiscordAdminMessaging,
  ): IndexerSyncService => {
    return new IndexerSyncService(requestsRepository, orchestrator, adminsMessaging);
  },
};
