import { Logger } from '@nestjs/common';

import { concurrent } from '@/helpers/concurrent';
import { RequestEntity, RequestsRepository, RequestStatus } from '@/services/database/requests';
import { IndexerOrchestrator } from '@/services/indexer-orchestrator';

const INDEXER_CONCURRENCY = 5;

export class IndexerSyncService {
  private static readonly logger = new Logger(IndexerSyncService.name);

  constructor(
    private readonly requestsRepository: RequestsRepository,
    private readonly orchestrator: IndexerOrchestrator,
  ) {}

  async sync(): Promise<void> {
    IndexerSyncService.logger.log('Checking indexer availability for missing and pending requests');

    const requests = await this.requestsRepository.listByStatuses([RequestStatus.Missing, RequestStatus.Pending]);
    IndexerSyncService.logger.log(`Found ${requests.length} requests to check`);

    await concurrent(requests, INDEXER_CONCURRENCY, (request) => this.checkOne(request));

    IndexerSyncService.logger.log('Indexer sync completed');
  }

  private async checkOne(request: RequestEntity): Promise<void> {
    if (!request.media || !request.media.imdbId) {
      return;
    }

    try {
      const winner = await this.orchestrator.runForRequest(request);

      if (winner === null && request.status === RequestStatus.Pending) {
        await this.requestsRepository.clearIndexerInfo(request.mediaId);
        await this.requestsRepository.updateStatus(request.mediaId, RequestStatus.Missing);
        IndexerSyncService.logger.log(
          `"${request.media.title}" (${request.media.imdbId}) no longer available, reverted to missing`,
        );
      }
    } catch (error) {
      IndexerSyncService.logger.error(
        `Indexer check failed for "${request.media.title}" (${request.media.imdbId}): ${error instanceof Error ? error.message : error}`,
      );
    }
  }
}
