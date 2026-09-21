import { Logger } from '@nestjs/common';

import { MediaTitles } from '@/modules/indexer/contract';
import { TmdbApiService, TmdbMovie, TmdbTvShow } from '@/modules/tmdb/tmdb';

/** `title` is the English one (null when TMDB has none), the rest as the contract defines. */
export type MediaTitlesResolution = Omit<MediaTitles, 'title'> & { title: string | null };

const UNKNOWN: MediaTitlesResolution = {
  title: null,
  originalTitle: null,
  frenchTitle: null,
  originalLanguage: null,
  year: null,
};

const ENGLISH = 'en-US';
const FRENCH = 'fr-FR';

type Localized = {
  title: string | null;
  originalTitle: string | null;
  originalLanguage: string | null;
  year: number | null;
};

function yearOf(date: string | undefined): number | null {
  return date ? Number(date.slice(0, 4)) : null;
}

function fromMovie(movie: TmdbMovie): Localized {
  return {
    title: movie.title || null,
    originalTitle: movie.original_title || null,
    originalLanguage: movie.original_language ?? null,
    year: yearOf(movie.release_date),
  };
}

function fromTvShow(show: TmdbTvShow): Localized {
  return {
    title: show.name || null,
    originalTitle: show.original_name || null,
    originalLanguage: show.original_language ?? null,
    year: yearOf(show.first_air_date),
  };
}

/**
 * Every name TMDB knows for an imdb id: the English title (canonical for the engine's
 * database and disk), the French one (what subscribers see and what French indexers key
 * on) and the original one. Two TMDB calls per id, memoised for the process lifetime.
 */
export class MediaTitlesResolver {
  private static readonly logger = new Logger(MediaTitlesResolver.name);

  private readonly cache = new Map<string, Promise<MediaTitlesResolution>>();

  constructor(private readonly tmdb: TmdbApiService) {}

  resolve(imdbId: string): Promise<MediaTitlesResolution> {
    const cached = this.cache.get(imdbId);
    if (cached) {
      return cached;
    }
    const resolution = this.lookup(imdbId).catch((error: unknown) => {
      MediaTitlesResolver.logger.warn(
        `TMDB lookup failed for ${imdbId}: ${error instanceof Error ? error.message : error}`,
      );
      return UNKNOWN;
    });
    this.cache.set(imdbId, resolution);
    return resolution;
  }

  private async lookup(imdbId: string): Promise<MediaTitlesResolution> {
    const english = await this.localized(imdbId, ENGLISH);
    if (!english) {
      return UNKNOWN;
    }
    const french = await this.localized(imdbId, FRENCH);
    return {
      title: english.title ?? english.originalTitle,
      originalTitle: english.originalTitle,
      frenchTitle: french?.title ?? null,
      originalLanguage: english.originalLanguage,
      year: english.year,
    };
  }

  private async localized(imdbId: string, language: string): Promise<Localized | null> {
    const { movies, tvShows } = await this.tmdb.findByImdbId(imdbId, { language });
    const movie = movies[0];
    if (movie) {
      return fromMovie(movie);
    }
    const show = tvShows[0];
    return show ? fromTvShow(show) : null;
  }
}
