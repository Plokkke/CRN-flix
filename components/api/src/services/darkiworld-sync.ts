import { Logger } from '@nestjs/common';

import { concurrent } from '@/helpers/concurrent';
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
    DarkiworldSyncService.logger.log('Checking Darkiworld availability for missing requests');
    const requests = await this.requestsRepository.listByStatuses([RequestStatus.Missing]);
    DarkiworldSyncService.logger.log(`Found ${requests.length} missing requests to check`);

    await concurrent(requests, DARKIWORLD_CONCURRENCY, (request) => this.checkOne(request));

    DarkiworldSyncService.logger.log('Darkiworld sync completed');
  }

  private async checkOne(request: RequestEntity): Promise<void> {
    if (!request.media || !request.media.imdbId) {
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
      DarkiworldSyncService.logger.log(
        `"${request.media.title}" (${request.media.imdbId}) now available on Darkiworld`,
      );
    } catch (error) {
      DarkiworldSyncService.logger.error(
        `Darkiworld check failed for "${request.media.title}" (${request.media.imdbId}): ${error instanceof Error ? error.message : error}`,
      );
    }
  }
}
