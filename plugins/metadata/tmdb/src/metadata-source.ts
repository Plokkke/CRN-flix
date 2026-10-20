import {
  createLogger,
  IdentificationQuery,
  IdentifiedMedia,
  MediaKind,
  MediaMetadata,
  MetadataSource,
} from '@crn-flix/contracts';

import { TmdbApiService, TmdbMovie, TmdbTvShow } from './api';
import { identifyMovie, identifyShow } from './identify';

/** TMDB serves posters anonymously in fixed widths; w342 suits emails and cards. */
const POSTER_BASE_URL = 'https://image.tmdb.org/t/p/w342';

const UNKNOWN: MediaMetadata = {
  title: null,
  originalTitle: null,
  frenchTitle: null,
  originalLanguage: null,
  year: null,
  kind: null,
  posterUrl: null,
};

const ENGLISH = 'en-US';
const FRENCH = 'fr-FR';

type Localized = {
  kind: MediaKind;
  title: string | null;
  originalTitle: string | null;
  originalLanguage: string | null;
  year: number | null;
  posterPath: string | null;
};

function posterUrlOf(path: string | null): string | null {
  return path ? `${POSTER_BASE_URL}${path}` : null;
}

function yearOf(date: string | undefined): number | null {
  return date ? Number(date.slice(0, 4)) : null;
}

function fromMovie(movie: TmdbMovie): Localized {
  return {
    kind: 'movie',
    title: movie.title || null,
    originalTitle: movie.original_title || null,
    originalLanguage: movie.original_language ?? null,
    year: yearOf(movie.release_date),
    posterPath: movie.poster_path ?? null,
  };
}

function fromTvShow(show: TmdbTvShow): Localized {
  return {
    kind: 'show',
    title: show.name || null,
    originalTitle: show.original_name || null,
    originalLanguage: show.original_language ?? null,
    year: yearOf(show.first_air_date),
    posterPath: show.poster_path ?? null,
  };
}

/**
 * Every name TMDB knows for an imdb id: the English title (canonical for the engine's
 * database and disk), the French one (what subscribers see and what French indexers key
 * on) and the original one, plus the poster (French artwork preferred). Two TMDB calls
 * per id, memoised for the process lifetime.
 */
export class TmdbMetadataSource implements MetadataSource {
  private static readonly logger = createLogger(TmdbMetadataSource.name);

  readonly name = 'tmdb';

  private readonly cache = new Map<string, Promise<MediaMetadata>>();

  constructor(private readonly tmdb: TmdbApiService) {}

  describe(imdbId: string): Promise<MediaMetadata> {
    const cached = this.cache.get(imdbId);
    if (cached) {
      return cached;
    }
    const resolution = this.lookup(imdbId).catch((error: unknown) => {
      TmdbMetadataSource.logger.warn(
        `TMDB lookup failed for ${imdbId}: ${error instanceof Error ? error.message : error}`,
      );
      return UNKNOWN;
    });
    this.cache.set(imdbId, resolution);
    return resolution;
  }

  identify(query: IdentificationQuery): Promise<IdentifiedMedia | null> {
    return query.kind === 'movie' ? identifyMovie(this.tmdb, query) : identifyShow(this.tmdb, query);
  }

  private async lookup(imdbId: string): Promise<MediaMetadata> {
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
      kind: english.kind,
      posterUrl: posterUrlOf(french?.posterPath ?? english.posterPath),
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
