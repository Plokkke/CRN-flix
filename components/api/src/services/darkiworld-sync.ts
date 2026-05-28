import { Logger } from '@nestjs/common';

import { concurrent } from '@/helpers/concurrent';
import { appendQueryParams } from '@/helpers/url';
import { DarkiworldService } from '@/modules/darkiworld/service';
import { RequestEntity, RequestsRepository, RequestStatus } from '@/services/database/requests';

const DARKIWORLD_CONCURRENCY = 5;

export class DarkiworldSyncService {
  private static readonly logger = new Logger(DarkiworldSyncService.name);

  constructor(
    private readonly requestsRepository: RequestsRepository,
    private readonly darkiworldService: DarkiworldService,
  ) {}

  async sync(): Promise<void> {
    DarkiworldSyncService.logger.log('Checking Darkiworld availability for missing and pending requests');

    if (!(await this.darkiworldService.isHealthy())) {
      DarkiworldSyncService.logger.warn('Darkiworld unreachable, skipping sync to avoid wiping URLs');
      return;
    }

    const requests = await this.requestsRepository.listByStatuses([RequestStatus.Missing, RequestStatus.Pending]);
    DarkiworldSyncService.logger.log(`Found ${requests.length} requests to check`);

    await concurrent(requests, DARKIWORLD_CONCURRENCY, (request) => this.checkOne(request));

    DarkiworldSyncService.logger.log('Darkiworld sync completed');
  }

  private async checkOne(request: RequestEntity): Promise<void> {
    if (!request.media || !request.media.imdbId) {
      return;
    }

    try {
      const result = await this.darkiworldService.find(request.media);

      if (result.status === 'available') {
        const downloadUrl = appendQueryParams(result.downloadUrl, {
          'crn-flix-request-id': request.mediaId,
          imdbid: request.media.imdbId,
        });
        await this.requestsRepository.setDarkiworldInfo(request.mediaId, result.title.id, downloadUrl);
        if (request.status === RequestStatus.Missing) {
          await this.requestsRepository.updateStatus(request.mediaId, RequestStatus.Pending);
          DarkiworldSyncService.logger.log(
            `"${request.media.title}" (${request.media.imdbId}) now available on Darkiworld`,
          );
        } else if (downloadUrl !== request.darkiworldUrl) {
          DarkiworldSyncService.logger.log(
            `"${request.media.title}" (${request.media.imdbId}) Darkiworld URL refreshed`,
          );
        }
        return;
      }

      if (result.status === 'not-found' && request.status === RequestStatus.Pending) {
        await this.requestsRepository.clearDarkiworldUrl(request.mediaId);
        await this.requestsRepository.updateStatus(request.mediaId, RequestStatus.Missing);
        DarkiworldSyncService.logger.log(
          `"${request.media.title}" (${request.media.imdbId}) no longer available on Darkiworld, reverted to missing`,
        );
      }
    } catch (error) {
      DarkiworldSyncService.logger.error(
        `Darkiworld check failed for "${request.media.title}" (${request.media.imdbId}): ${error instanceof Error ? error.message : error}`,
      );
    }
  }
}
