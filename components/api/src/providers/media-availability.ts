import { DarkiworldService } from '@/modules/darkiworld/service';
import { JellyfinMediaService } from '@/modules/jellyfin/jellyfin';
import { RequestsRepository } from '@/services/database/requests';
import { MediaAvailabilityService } from '@/services/media-availability';

export const mediaAvailabilityProvider = {
  provide: MediaAvailabilityService,
  inject: [RequestsRepository, JellyfinMediaService, DarkiworldService],
  useFactory: (
    requestsRepository: RequestsRepository,
    jellyfin: JellyfinMediaService,
    darkiworldService: DarkiworldService,
  ): MediaAvailabilityService => {
    return new MediaAvailabilityService(requestsRepository, jellyfin, darkiworldService);
  },
};
