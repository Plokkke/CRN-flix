import { Logger } from '@nestjs/common';

import { MediaTitles } from '@/modules/indexer/contract';
import { MediasRepository } from '@/services/database/medias';
import { MediaTitlesResolution, MediaTitlesResolver } from '@/services/media-titles-resolver';

/** One TMDB pair of calls per title, twice a second at most: an hour of backlog per run. */
const BACKFILL_BATCH = 200;

/**
 * Syncs write what their source knows (Trakt: the English title only); the French title,
 * the original one and its language are resolved from TMDB once and persisted on every
 * row of the imdb id — on demand before an indexer search, and hourly for the rest.
 */
export class MediaTitlesService {
  private static readonly logger = new Logger(MediaTitlesService.name);

  constructor(
    private readonly resolver: MediaTitlesResolver,
    private readonly medias: MediasRepository,
  ) {}

  /** The titles to hand an indexer: the stored ones, completed from TMDB when the French one is unknown. */
  async ensure(imdbId: string, known: MediaTitles): Promise<MediaTitles> {
    if (known.frenchTitle !== null) {
      return known;
    }
    const resolved = await this.resolveAndPersist(imdbId);
    return resolved
      ? {
          title: resolved.title ?? known.title,
          originalTitle: resolved.originalTitle ?? known.originalTitle,
          frenchTitle: resolved.frenchTitle,
          originalLanguage: resolved.originalLanguage,
          year: known.year ?? resolved.year,
        }
      : known;
  }

  async backfill(): Promise<void> {
    const imdbIds = await this.medias.listImdbIdsWithoutFrenchTitle(BACKFILL_BATCH);
    let resolved = 0;
    for (const imdbId of imdbIds) {
      resolved += (await this.resolveAndPersist(imdbId)) ? 1 : 0;
    }
    if (imdbIds.length > 0) {
      MediaTitlesService.logger.log(`Backfilled titles for ${resolved}/${imdbIds.length} imdb id(s)`);
    }
  }

  /** Null when TMDB knows nothing about the id (the stored titles stay as they are). */
  private async resolveAndPersist(imdbId: string): Promise<MediaTitlesResolution | null> {
    const resolved = await this.resolver.resolve(imdbId);
    if (!resolved.title && !resolved.frenchTitle) {
      return null;
    }
    await this.medias.updateTitles(imdbId, resolved);
    return resolved;
  }
}
