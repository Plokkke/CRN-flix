import { Inject, Logger } from '@nestjs/common';

import { Indexer, INDEXERS, IndexerCandidate, passesPreferences } from '@/modules/indexer/contract';
import { EnginePreferences } from '@/modules/indexer/preferences';
import { RequestEntity, RequestsRepository, RequestStatus } from '@/services/database/requests';
import { FetchrSyncService } from '@/services/fetchr-sync';
import { scoreOf } from '@/services/indexer-scoring';

export class IndexerOrchestrator {
  private static readonly logger = new Logger(IndexerOrchestrator.name);

  constructor(
    @Inject(INDEXERS) private readonly indexers: Indexer[],
    private readonly fetchr: FetchrSyncService,
    private readonly requests: RequestsRepository,
    private readonly defaultPreferences: EnginePreferences,
  ) {}

  async runForRequest(
    request: RequestEntity,
    prefs: EnginePreferences = this.defaultPreferences,
  ): Promise<IndexerCandidate | null> {
    if (!request.media || !request.media.imdbId) {
      return null;
    }

    const candidates: IndexerCandidate[] = [];
    for (const indexer of this.indexers) {
      try {
        candidates.push(...(await indexer.find(request.media, prefs)));
      } catch (err) {
        IndexerOrchestrator.logger.warn(
          `${indexer.name}.find inconclusive for ${request.media.imdbId}: ${err instanceof Error ? err.message : err}`,
        );
      }
    }

    const eligible = candidates.filter((c) => passesPreferences(c, request.media!, prefs));
    if (!eligible.length) {
      return null;
    }

    const enriched = await Promise.all(
      eligible.map(async (candidate) => ({
        candidate,
        autoTriggerable: await this.fetchr.canHandle(candidate.url),
      })),
    );
    enriched.sort(
      (a, b) => scoreOf(b.candidate, prefs, b.autoTriggerable) - scoreOf(a.candidate, prefs, a.autoTriggerable),
    );

    const winner = enriched[0];
    const candidate = winner.candidate;

    await this.requests.setIndexerInfo(request.mediaId, candidate.indexerName, candidate.url);
    if (request.status === RequestStatus.Missing) {
      await this.requests.updateStatus(request.mediaId, RequestStatus.Pending);
    }

    if (winner.autoTriggerable) {
      this.fetchr.download(candidate.url, {
        'crn-flix-request-id': request.mediaId,
        imdbid: request.media.imdbId,
      });
    }

    return candidate;
  }
}
