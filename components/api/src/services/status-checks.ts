import { Logger } from '@nestjs/common';

import { concurrent } from '@/helpers/concurrent';
import { DarkiworldService } from '@/modules/darkiworld/service';
import { JellyfinMedia, JellyfinMediaService } from '@/modules/jellyfin/jellyfin';
import { MediaInfos } from '@/services/database/medias';
import { RequestEntity, RequestsRepository, RequestStatus } from '@/services/database/requests';

type MediaCompositeKey = string;

function compositeKey(media: Pick<MediaInfos, 'imdbId' | 'seasonNumber' | 'episodeNumber'>): MediaCompositeKey {
  return `${media.imdbId}:${media.seasonNumber ?? -1}:${media.episodeNumber ?? -1}`;
}

const DARKIWORLD_CONCURRENCY = 5;

export class StatusCheckService {
  private static readonly logger = new Logger(StatusCheckService.name);

  constructor(
    private readonly requestsRepository: RequestsRepository,
    private readonly jellyfin: JellyfinMediaService,
    private readonly darkiworldService: DarkiworldService,
  ) {}

  async checkDarkiworldAvailability(): Promise<void> {
    StatusCheckService.logger.log('Checking Darkiworld availability for missing requests');
    const requests = await this.requestsRepository.listByStatuses([RequestStatus.Missing]);
    StatusCheckService.logger.log(`Found ${requests.length} missing requests to check`);

    await concurrent(requests, DARKIWORLD_CONCURRENCY, (request) => this.checkOneDarkiworld(request));

    StatusCheckService.logger.log('Darkiworld availability check completed');
  }

  async checkJellyfinFulfillment(): Promise<void> {
    StatusCheckService.logger.log('Checking Jellyfin fulfillment for missing/pending requests');
    const requests = await this.requestsRepository.listByStatuses([RequestStatus.Missing, RequestStatus.Pending]);
    StatusCheckService.logger.log(`Found ${requests.length} requests to check against Jellyfin`);

    const jellyfinMedias = await this.jellyfin.listAssets();
    const jellyfinKeys = new Set(
      jellyfinMedias.map((m: JellyfinMedia) =>
        compositeKey({
          imdbId: m.ProviderIds.Imdb,
          seasonNumber: m.ParentIndexNumber ?? null,
          episodeNumber: m.IndexNumber ?? null,
        }),
      ),
    );

    let fulfilled = 0;
    for (const request of requests) {
      if (!request.media) {
        continue;
      }
      const key = compositeKey(request.media);
      if (jellyfinKeys.has(key)) {
        await this.requestsRepository.updateStatus(request.mediaId, RequestStatus.Fulfilled);
        fulfilled += 1;
      }
    }

    StatusCheckService.logger.log(`Jellyfin check completed: ${fulfilled} requests fulfilled`);
  }

  private async checkOneDarkiworld(request: RequestEntity): Promise<void> {
    if (!request.media) {
      return;
    }

    try {
      const result = await this.darkiworldService.find(request.media);
      if (!result.available) {
        return;
      }

      const darkiworldTitleId = result.title?.id ?? null;
      if (darkiworldTitleId) {
        await this.requestsRepository.setDarkiworldInfo(request.mediaId, darkiworldTitleId, result.downloadUrl);
      }
      await this.requestsRepository.updateStatus(request.mediaId, RequestStatus.Pending);
      StatusCheckService.logger.log(`"${request.media.title}" (${request.media.imdbId}) now available on Darkiworld`);
    } catch (error) {
      StatusCheckService.logger.error(
        `Darkiworld check failed for "${request.media.title}" (${request.media.imdbId}): ${error instanceof Error ? error.message : error}`,
      );
    }
  }
}
