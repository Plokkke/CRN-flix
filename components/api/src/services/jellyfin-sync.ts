import { Logger } from '@nestjs/common';

import { JellyfinMedia, JellyfinMediaService } from '@/modules/jellyfin/jellyfin';
import { MediaInfos, MediasRepository, MediaType } from '@/services/database/medias';
import { RequestsRepository } from '@/services/database/requests';

function jellyfinMediaToInfos(m: JellyfinMedia): MediaInfos {
  return {
    imdbId: m.ProviderIds.Imdb,
    type: m.Type === 'Movie' ? MediaType.Movie : MediaType.Episode,
    title: m.SeriesName ?? m.Name,
    year: m.ProductionYear,
    seasonNumber: m.ParentIndexNumber ?? null,
    episodeNumber: m.IndexNumber ?? null,
  };
}

export class JellyfinSyncService {
  private static readonly logger = new Logger(JellyfinSyncService.name);

  constructor(
    private readonly requestsRepository: RequestsRepository,
    private readonly mediasRepository: MediasRepository,
    private readonly jellyfin: JellyfinMediaService,
  ) {}

  async sync(): Promise<void> {
    JellyfinSyncService.logger.log('Importing Jellyfin assets as fulfilled media/requests');

    const jellyfinMedias = await this.jellyfin.listAssets();
    JellyfinSyncService.logger.log(`Jellyfin returned ${jellyfinMedias.length} assets`);

    let imported = 0;
    for (const jMedia of jellyfinMedias) {
      const infos = jellyfinMediaToInfos(jMedia);
      if (!infos.imdbId) {
        continue;
      }

      const media = await this.mediasRepository.upsert(infos);
      await this.requestsRepository.upsertFulfilled(media.id);
      imported += 1;
    }

    JellyfinSyncService.logger.log(`Jellyfin sync completed: ${imported} assets upserted as fulfilled`);
  }
}
