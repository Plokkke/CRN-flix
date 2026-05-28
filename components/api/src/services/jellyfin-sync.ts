import { Logger } from '@nestjs/common';

import { JellyfinMedia, JellyfinMediaService } from '@/modules/jellyfin/jellyfin';
import { MediaInfos, MediasRepository, MediaType } from '@/services/database/medias';
import { RequestsRepository } from '@/services/database/requests';

function jellyfinMediaToInfos(m: JellyfinMedia, seriesImdbById: Map<string, string>): MediaInfos | null {
  if (m.Type === 'Series') {
    return null;
  }

  let imdbId: string | undefined = m.ProviderIds.Imdb;
  if (m.Type === 'Episode') {
    // Episode-level ProviderIds.Imdb is the episode imdb, not the series' —
    // resolve the series' imdb via SeriesId so downstream matching works.
    const seriesImdb = m.SeriesId ? seriesImdbById.get(m.SeriesId) : undefined;
    imdbId = seriesImdb ?? imdbId;
  }

  return {
    imdbId: imdbId ?? '',
    type: m.Type === 'Movie' ? MediaType.Movie : MediaType.Episode,
    title: m.SeriesName ?? m.Name,
    originalTitle: null,
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

    const seriesImdbById = new Map<string, string>();
    for (const m of jellyfinMedias) {
      if (m.Type === 'Series' && m.ProviderIds?.Imdb) {
        seriesImdbById.set(m.Id, m.ProviderIds.Imdb);
      }
    }
    JellyfinSyncService.logger.log(`Indexed ${seriesImdbById.size} series with IMDb IDs`);

    let imported = 0;
    let skippedNoImdb = 0;
    let skippedUnresolvedSeries = 0;
    for (const jMedia of jellyfinMedias) {
      const infos = jellyfinMediaToInfos(jMedia, seriesImdbById);
      if (!infos) {
        continue;
      }
      if (!infos.imdbId) {
        if (jMedia.Type === 'Episode' && jMedia.SeriesId && !seriesImdbById.has(jMedia.SeriesId)) {
          skippedUnresolvedSeries += 1;
        } else {
          skippedNoImdb += 1;
        }
        continue;
      }

      const media = await this.mediasRepository.upsert(infos);
      await this.requestsRepository.upsertFulfilled(media.id);
      imported += 1;
    }

    JellyfinSyncService.logger.log(
      `Jellyfin sync completed: ${imported} upserted, ${skippedNoImdb} skipped (no imdb), ${skippedUnresolvedSeries} skipped (episode with unknown series imdb)`,
    );
  }
}
