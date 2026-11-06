import { Logger } from '@nestjs/common';

import { MediaFacts, MetadataSource } from '@crn-flix/contracts';

import { MediaFactsRepository, StoredFacts } from '@/services/database/media-facts';
import { IntegrationTracker } from '@/services/integrations/monitor';

/** Bump when `MediaFacts` changes shape: rows written before are fetched again. */
export const FACTS_SCHEMA_VERSION = 1;

const DAY_MS = 24 * 60 * 60 * 1000;
/** Credits and ratings of a released title barely move; a title the source ignores may be added any day. */
const KNOWN_FRESHNESS_MS = 30 * DAY_MS;
const UNKNOWN_FRESHNESS_MS = DAY_MS;
/** Two TMDB calls per title: a few minutes of rate-limited calls per run. */
const REFRESH_BATCH = 100;

const describeError = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/**
 * The facts policies evaluate, fetched from the metadata source once and persisted per imdb id:
 * rules can be re-evaluated without calling the source again, and the admin sees what a
 * decision rests on. Refreshed hourly, oldest first.
 */
export class MediaFactsService {
  private static readonly logger = new Logger(MediaFactsService.name);

  constructor(
    private readonly source: MetadataSource,
    private readonly stored: MediaFactsRepository,
    private readonly tracker: IntegrationTracker,
    private readonly now: () => number = Date.now,
  ) {}

  /** Stored facts when written in the current shape (stale ones included), fetched otherwise; throws when the source fails. */
  async ensure(imdbId: string): Promise<MediaFacts | null> {
    const stored = await this.stored.get(imdbId);
    if (stored && this.isCurrentShape(stored)) {
      return stored.facts;
    }
    return this.fetchAndStore(imdbId);
  }

  async refresh(): Promise<void> {
    const now = this.now();
    const imdbIds = await this.stored.listImdbIdsToRefresh({
      schemaVersion: FACTS_SCHEMA_VERSION,
      knownFetchedBefore: new Date(now - KNOWN_FRESHNESS_MS),
      unknownFetchedBefore: new Date(now - UNKNOWN_FRESHNESS_MS),
      limit: REFRESH_BATCH,
    });
    const outcomes = { known: 0, failed: 0 };
    for (const imdbId of imdbIds) {
      try {
        outcomes.known += (await this.fetchAndStore(imdbId)) ? 1 : 0;
      } catch (error) {
        outcomes.failed += 1;
        MediaFactsService.logger.warn(`Facts refresh failed for ${imdbId}: ${describeError(error)}`);
      }
    }
    if (imdbIds.length > 0) {
      MediaFactsService.logger.log(
        `Refreshed facts of ${imdbIds.length} title(s): ${outcomes.known} known, ${outcomes.failed} failed`,
      );
    }
  }

  private isCurrentShape(stored: StoredFacts): boolean {
    return stored.schemaVersion === FACTS_SCHEMA_VERSION;
  }

  private async fetchAndStore(imdbId: string): Promise<MediaFacts | null> {
    const facts = await this.tracker.track(this.source.name, 'facts', () => this.source.facts(imdbId));
    await this.stored.save(imdbId, facts, FACTS_SCHEMA_VERSION);
    return facts;
  }
}
