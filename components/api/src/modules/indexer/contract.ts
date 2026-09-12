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

/** What a single release covers: one movie, one episode, a season pack or a full-series pack. */
export type CandidateScope =
  | { kind: 'movie' }
  | { kind: 'episode'; season: number; episode: number }
  | { kind: 'season'; season: number }
  | { kind: 'series' };

export function scopeKey(scope: CandidateScope): string {
  switch (scope.kind) {
    case 'movie':
      return 'movie';
    case 'episode':
      return `episode:${scope.season}:${scope.episode}`;
    case 'season':
      return `season:${scope.season}`;
    case 'series':
      return 'series';
  }
}

export type IndexerCandidate = {
  indexerName: string;
  url: string;
  scope: CandidateScope;
  quality: Quality;
  language: Language;
  host: Host;
  sizeBytes: number | null;
};

export type IndexerShowEpisode = {
  season: number;
  episode: number;
  runtimeMinutes: number | null;
};

/** One search per show (not per episode): the target carries the full episode intent. */
export type IndexerTarget =
  | { kind: 'movie'; media: IndexerMedia }
  | {
      kind: 'show';
      imdbId: string;
      title: string;
      originalTitle: string | null;
      year: number | null;
      episodes: ReadonlyArray<IndexerShowEpisode>;
    };

/**
 * What an indexer wants remembered about one media (imdb id), persisted by the engine
 * and handed back on the next `find`. The engine never interprets `state`: it is the
 * indexer's own (a media id, per-season page urls, nothing…), validated by the indexer.
 * The two urls are the only generic part, so any surface can link a human to the indexer.
 */
export type IndexerBookmark = {
  /** The media's page on the indexer, when it was matched. */
  pageUrl: string | null;
  /** A manual search for the media on the indexer, for when it was not. */
  searchUrl: string | null;
  state: unknown;
};

export type IndexerFindResult = {
  candidates: IndexerCandidate[];
  /** Returned unchanged when there is nothing new to remember; null forgets the stored one. */
  bookmark: IndexerBookmark | null;
};

/**
 * `find` returns every usable release it knows for the target, **without** applying the
 * preferences: the engine assesses candidates itself (`assessCandidate`) so that a
 * rejection can be shown and, for quality/size, overridden. `prefs` is informational.
 */
export interface Indexer {
  readonly name: string;
  find(target: IndexerTarget, prefs: EnginePreferences, bookmark: IndexerBookmark | null): Promise<IndexerFindResult>;
}

export function targetImdbId(target: IndexerTarget): string {
  return target.kind === 'movie' ? target.media.imdbId : target.imdbId;
}

export function targetTitle(target: IndexerTarget): string {
  return target.kind === 'movie' ? target.media.title : target.title;
}

export function scopeCoveredEpisodes(scope: CandidateScope, target: IndexerTarget): IndexerShowEpisode[] {
  if (target.kind === 'movie') {
    return [];
  }
  switch (scope.kind) {
    case 'movie':
      return [];
    case 'episode':
      return target.episodes.filter((e) => e.season === scope.season && e.episode === scope.episode);
    case 'season':
      return target.episodes.filter((e) => e.season === scope.season);
    case 'series':
      return [...target.episodes];
  }
}

/** Guard rails when a runtime is unknown: the size cap must never silently pass. */
export const DEFAULT_MOVIE_RUNTIME_MINUTES = 120;
export const DEFAULT_EPISODE_RUNTIME_MINUTES = 45;

/** Total viewing minutes a candidate covers, for the size cap; null when unknown. */
export function scopeRuntimeMinutes(scope: CandidateScope, target: IndexerTarget): number | null {
  if (target.kind === 'movie') {
    return target.media.runtimeMinutes;
  }
  const episodes = scopeCoveredEpisodes(scope, target);
  if (episodes.length === 0 || episodes.some((e) => e.runtimeMinutes === null)) {
    return null;
  }
  return episodes.reduce((acc, e) => acc + (e.runtimeMinutes ?? 0), 0);
}

/** Why a candidate is not eligible under the engine preferences. */
export enum RejectReason {
  QualityNotAllowed = 'quality-not-allowed',
  LanguageNotAllowed = 'language-not-allowed',
  HostNotAllowed = 'host-not-allowed',
  SizeExceeded = 'size-exceeded',
}

/** Reasons an admin can override by relaxing preferences; the others mean no usable source exists. */
export const FORCEABLE_REASONS: readonly RejectReason[] = [RejectReason.QualityNotAllowed, RejectReason.SizeExceeded];

export const isForceable = (reasons: RejectReason[]): boolean =>
  reasons.length > 0 && reasons.every((reason) => FORCEABLE_REASONS.includes(reason));

/**
 * Every reason the candidate fails the preferences (empty = eligible). Indexers return
 * every usable release unfiltered; the engine assesses them so a rejection can be explained.
 */
/** Known runtime when complete, otherwise the sum of defaults (a missing episode runtime counts 45 min). */
export function estimatedScopeRuntimeMinutes(scope: CandidateScope, target: IndexerTarget): number {
  if (target.kind === 'movie') {
    return target.media.runtimeMinutes ?? DEFAULT_MOVIE_RUNTIME_MINUTES;
  }
  return scopeCoveredEpisodes(scope, target).reduce(
    (acc, e) => acc + (e.runtimeMinutes ?? DEFAULT_EPISODE_RUNTIME_MINUTES),
    0,
  );
}

export function assessCandidate(
  candidate: IndexerCandidate,
  target: IndexerTarget,
  prefs: EnginePreferences,
): RejectReason[] {
  const reasons: RejectReason[] = [];
  if (!isAllowed(prefs.allowedQualities, candidate.quality)) {
    reasons.push(RejectReason.QualityNotAllowed);
  }
  if (!isAllowed(prefs.allowedLanguages, candidate.language)) {
    reasons.push(RejectReason.LanguageNotAllowed);
  }
  if (!isAllowed(prefs.allowedHosts, candidate.host)) {
    reasons.push(RejectReason.HostNotAllowed);
  }
  const runtimeMinutes = estimatedScopeRuntimeMinutes(candidate.scope, target);
  if (candidate.sizeBytes !== null && runtimeMinutes > 0) {
    const cap = maxSizeBytes(candidate.quality, runtimeMinutes, prefs.sizePolicy);
    if (cap !== null && candidate.sizeBytes > cap) {
      reasons.push(RejectReason.SizeExceeded);
    }
  }
  return reasons;
}

export function passesPreferences(
  candidate: IndexerCandidate,
  target: IndexerTarget,
  prefs: EnginePreferences,
): boolean {
  return assessCandidate(candidate, target, prefs).length === 0;
}

export const INDEXERS = Symbol('Indexers');
