export enum MediaType {
  Movie = 'movie',
  Episode = 'episode',
}

/**
 * Every name the engine knows for a title, so an indexer can pick the queries that fit
 * its own audience (a French site searches the French title first, a foreign one the
 * original) or bail out early (an anime-only indexer on a `originalLanguage` it never
 * carries). `title` is the English title, the engine's canonical one (database, disk).
 */
export type MediaTitles = {
  title: string;
  originalTitle: string | null;
  frenchTitle: string | null;
  /** ISO 639-1 code of the original language, when known (e.g. "ja", "ko", "fr"). */
  originalLanguage: string | null;
  year: number | null;
};

/**
 * One requestable unit: a movie, or one episode of a show (`imdbId` is then the show's).
 * Owned by the contracts so that plugins never depend on the engine's persistence layer.
 */
export type MediaItem = MediaTitles & {
  imdbId: string;
  type: MediaType;
  seasonNumber: number | null;
  episodeNumber: number | null;
  runtimeMinutes: number | null;
};

/** Where a viewer stands in a show: the next episode to watch, null when completed or dropped. */
export type Playhead = {
  nextSeason: number | null;
  nextEpisode: number | null;
};

/** Nothing watched yet: every episode lies ahead. */
export const START_OF_SHOW: Playhead = { nextSeason: 0, nextEpisode: 0 };
