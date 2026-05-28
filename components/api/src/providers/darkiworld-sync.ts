import { DarkiworldService } from '@/modules/darkiworld/service';
import { DarkiworldSyncService } from '@/services/darkiworld-sync';
import { RequestsRepository } from '@/services/database/requests';

export const darkiworldSyncProvider = {
  provide: DarkiworldSyncService,
  inject: [RequestsRepository, DarkiworldService],
  useFactory: (requestsRepository: RequestsRepository, darkiworldService: DarkiworldService): DarkiworldSyncService => {
    return new DarkiworldSyncService(requestsRepository, darkiworldService);
  },
};
