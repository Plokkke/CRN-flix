import {
  createLogger,
  IdentificationQuery,
  IdentifiedMedia,
  MediaFacts,
  MediaKind,
  MediaMetadata,
  MetadataSource,
  PersonCandidate,
  ReferencedMedia,
} from '@crn-flix/contracts';

import { TmdbApiService, TmdbMovie, TmdbPageKind, TmdbTvShow } from './api';
import { movieFacts, personCandidates, tvFacts } from './facts';
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

/** A TMDB page URL (any locale prefix, slug or query) → its reference `movie/<id>` or `tv/<id>`. */
const PAGE_URL_PATTERN = /themoviedb\.org\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?(movie|tv)\/(\d+)/i;
const REFERENCE_PATTERN = /^(movie|tv)\/(\d+)$/;

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

/** The English description, completed with the French title and artwork. */
function metadataOf(english: Localized, french: Localized | null): MediaMetadata {
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

/**
 * Every name TMDB knows for an imdb id: the English title (canonical for the engine's
 * database and disk), the French one (what subscribers see and what French indexers key
 * on) and the original one, plus the poster (French artwork preferred). Two TMDB calls
 * per id; what TMDB knows is memoised for the process lifetime, unknown ids and failures are
asked again (an admin may just have linked the id on TMDB). A pasted TMDB page URL is a
reference: the page itself is read, whether it links an imdb id or not.
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
    void resolution.then((metadata) => metadata === UNKNOWN && this.cache.delete(imdbId));
    return resolution;
  }

  findReference(text: string): string | null {
    const match = text.match(PAGE_URL_PATTERN);
    return match ? `${match[1].toLowerCase()}/${match[2]}` : null;
  }

  async describeReference(reference: string): Promise<ReferencedMedia | null> {
    const match = reference.match(REFERENCE_PATTERN);
    if (!match) {
      return null;
    }
    const kind = match[1] as TmdbPageKind;
    const tmdbId = Number(match[2]);
    const english = await this.page(kind, tmdbId, ENGLISH);
    if (!english) {
      return null;
    }
    const french = await this.page(kind, tmdbId, FRENCH);
    return {
      ...metadataOf(english.localized, french?.localized ?? null),
      kind: english.localized.kind,
      imdbId: english.imdbId,
      pageUrl: `https://www.themoviedb.org/${reference}`,
    };
  }

  private async page(
    kind: TmdbPageKind,
    tmdbId: number,
    language: string,
  ): Promise<{ localized: Localized; imdbId: string | null } | null> {
    const page = kind === 'movie' ? await this.tmdb.getPage('movie', tmdbId, language) : null;
    if (page) {
      return { localized: fromMovie(page), imdbId: page.external_ids.imdb_id || null };
    }
    const show = kind === 'tv' ? await this.tmdb.getPage('tv', tmdbId, language) : null;
    return show ? { localized: fromTvShow(show), imdbId: show.external_ids.imdb_id || null } : null;
  }

  async facts(imdbId: string): Promise<MediaFacts | null> {
    const { movies, tvShows } = await this.tmdb.findByImdbId(imdbId);
    const movie = movies[0];
    if (movie) {
      return movieFacts(await this.tmdb.getMovieDetails(movie.id));
    }
    const show = tvShows[0];
    return show ? tvFacts(await this.tmdb.getTvDetails(show.id)) : null;
  }

  async searchPeople(name: string): Promise<PersonCandidate[]> {
    return personCandidates(await this.tmdb.searchPeople(name));
  }

  identify(query: IdentificationQuery): Promise<IdentifiedMedia | null> {
    return query.kind === 'movie' ? identifyMovie(this.tmdb, query) : identifyShow(this.tmdb, query);
  }

  private async lookup(imdbId: string): Promise<MediaMetadata> {
    const english = await this.localized(imdbId, ENGLISH);
    if (!english) {
      return UNKNOWN;
    }
    return metadataOf(english, await this.localized(imdbId, FRENCH));
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
