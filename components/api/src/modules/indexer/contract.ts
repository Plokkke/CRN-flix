import { EnginePreferences, Host, isAllowed, Language, maxSizeBytes, Quality } from './preferences';

export enum MediaType {
  Movie = 'movie',
  Episode = 'episode',
}

/**
 * The media description handed to indexers. Owned by the contract so that
 * indexer implementations never depend on the engine's persistence layer.
 */
export type IndexerMedia = {
  imdbId: string;
  type: MediaType;
  title: string;
  originalTitle: string | null;
  year: number | null;
  seasonNumber: number | null;
  episodeNumber: number | null;
  runtimeMinutes: number | null;
};

export type IndexerCandidate = {
  indexerName: string;
  url: string;
  quality: Quality;
  language: Language;
  host: Host;
  sizeBytes: number | null;
};

export interface Indexer {
  readonly name: string;
  find(media: IndexerMedia, prefs: EnginePreferences): Promise<IndexerCandidate[]>;
}

export function passesPreferences(candidate: IndexerCandidate, media: IndexerMedia, prefs: EnginePreferences): boolean {
  if (
    !isAllowed(prefs.allowedQualities, candidate.quality) ||
    !isAllowed(prefs.allowedHosts, candidate.host) ||
    !isAllowed(prefs.allowedLanguages, candidate.language)
  ) {
    return false;
  }
  if (candidate.sizeBytes !== null && media.runtimeMinutes !== null) {
    const cap = maxSizeBytes(candidate.quality, media.runtimeMinutes, prefs.sizePolicy);
    if (cap !== null && candidate.sizeBytes > cap) {
      return false;
    }
  }
  return true;
}

export const INDEXERS = Symbol('Indexers');
