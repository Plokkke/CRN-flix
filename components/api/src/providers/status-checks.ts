import { DarkiworldService } from '@/modules/darkiworld/service';
import { JellyfinMediaService } from '@/modules/jellyfin/jellyfin';
import { RequestsRepository } from '@/services/database/requests';
import { StatusCheckService } from '@/services/status-checks';

export const statusCheckProvider = {
  provide: StatusCheckService,
  inject: [RequestsRepository, JellyfinMediaService, DarkiworldService],
  useFactory: (
    requestsRepository: RequestsRepository,
    jellyfin: JellyfinMediaService,
    darkiworldService: DarkiworldService,
  ): StatusCheckService => {
    return new StatusCheckService(requestsRepository, jellyfin, darkiworldService);
  },
};
