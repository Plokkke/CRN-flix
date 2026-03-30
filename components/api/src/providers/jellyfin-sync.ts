import { JellyfinMediaService } from '@/modules/jellyfin/jellyfin';
import { MediasRepository } from '@/services/database/medias';
import { RequestsRepository } from '@/services/database/requests';
import { JellyfinSyncService } from '@/services/jellyfin-sync';

export const jellyfinSyncProvider = {
  provide: JellyfinSyncService,
  inject: [RequestsRepository, MediasRepository, JellyfinMediaService],
  useFactory: (
    requestsRepository: RequestsRepository,
    mediasRepository: MediasRepository,
    jellyfin: JellyfinMediaService,
  ): JellyfinSyncService => {
    return new JellyfinSyncService(requestsRepository, mediasRepository, jellyfin);
  },
};
