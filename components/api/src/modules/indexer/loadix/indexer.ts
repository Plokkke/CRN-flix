import { Logger } from '@nestjs/common';
import axios from 'axios';
import { z } from 'zod';

import {
  CandidateScope,
  Indexer,
  IndexerBookmark,
  IndexerCandidate,
  IndexerFindResult,
  IndexerTarget,
  MediaTitles,
  scopeKey,
  targetImdbId,
  targetTitle,
  targetTitles,
} from '@/modules/indexer/contract';
import { EnginePreferences } from '@/modules/indexer/preferences';
import { buildSearchQueries, isSameTitle } from '@/modules/indexer/query';

import { LoadixApi, YearRange } from './api';
import { mapHost, mapLanguage, mapQuality } from './mapping';
import { LoadixLink, LoadixMediaDetail, LoadixSearchHit } from './schemas';

/** Matching costs one detail fetch per plausible hit; cap them so one find() stays cheap. */
const MAX_DETAIL_LOOKUPS = 5;
/** Hits that merely resemble the title spend at most this much of the budget per query. */
const FUZZY_LOOKUPS_PER_QUERY = 2;
/** Trakt and Loadix can disagree by a year on a release date (premiere vs. wide release). */
const YEAR_TOLERANCE = 1;

/**
 * Loadix files animation under its own `anime` type, whether it is a film or a show
 * ("La Pat' Patrouille" is an anime series). The imdb check on the detail settles it.
 */
const MOVIE_HIT_TYPES = ['movie', 'anime'];
const SHOW_HIT_TYPES = ['series', 'anime'];

/** What Loadix remembers per media: enough to list links without searching again. */
const bookmarkStateSchema = z.object({
  mediaId: z.string().min(1),
  seasons: z.array(z.object({ id: z.string(), seasonNumber: z.number() })),
});

type BookmarkState = z.infer<typeof bookmarkStateSchema>;

type ShowTarget = Extract<IndexerTarget, { kind: 'show' }>;

export class LoadixIndexer implements Indexer {
  private static readonly logger = new Logger(LoadixIndexer.name);

  readonly name = 'loadix';

  private readonly siteHost: string;

  constructor(
    private readonly api: LoadixApi,
    siteHost: string,
  ) {
    this.siteHost = siteHost.replace(/\/+$/, '');
  }

  async find(
    target: IndexerTarget,
    _prefs: EnginePreferences,
    bookmark: IndexerBookmark | null,
  ): Promise<IndexerFindResult> {
    if (!targetImdbId(target)) {
      return { candidates: [], bookmark };
    }

    const remembered = bookmarkStateSchema.safeParse(bookmark?.state);
    const fromBookmark = remembered.success ? await this.findFromBookmark(remembered.data, target) : null;
    return fromBookmark ?? this.findFromSearch(target);
  }

  /** Null when the remembered media is gone or no longer matches: the search path takes over. */
  private async findFromBookmark(state: BookmarkState, target: IndexerTarget): Promise<IndexerFindResult | null> {
    try {
      const detail = await this.detailFromBookmark(state, target);
      return detail ? await this.collect(detail, target) : null;
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 404) {
        LoadixIndexer.logger.warn(`Bookmarked Loadix media ${state.mediaId} is gone, searching again`);
        return null;
      }
      throw error;
    }
  }

  /** One detail fetch only when the intent reaches a season the bookmark does not know. */
  private async detailFromBookmark(state: BookmarkState, target: IndexerTarget): Promise<LoadixMediaDetail | null> {
    const knownSeasons = new Set(state.seasons.map((s) => s.seasonNumber));
    const needsRefresh = target.kind === 'show' && target.episodes.some((e) => !knownSeasons.has(e.season));
    if (!needsRefresh) {
      return {
        media: {
          id: state.mediaId,
          type: target.kind === 'movie' ? 'movie' : 'series',
          imdbId: targetImdbId(target),
          title: targetTitle(target),
        },
        seasons: state.seasons,
      };
    }

    const detail = await this.api.getMedia(state.mediaId);
    return detail.media.imdbId === targetImdbId(target) ? detail : null;
  }

  private async findFromSearch(target: IndexerTarget): Promise<IndexerFindResult> {
    const match = await this.findMedia(target);
    if (!match) {
      LoadixIndexer.logger.debug(`No Loadix match for "${targetTitle(target)}" (${targetImdbId(target)})`);
      return { candidates: [], bookmark: { pageUrl: null, searchUrl: this.searchUrl(target), state: null } };
    }
    return this.collect(match, target);
  }

  /** Unfiltered on purpose: the engine assesses every release against its preferences. */
  private async collect(detail: LoadixMediaDetail, target: IndexerTarget): Promise<IndexerFindResult> {
    const links =
      target.kind === 'movie' ? await this.findMovieLinks(detail) : await this.findShowLinks(detail, target);
    LoadixIndexer.logger.log(`Loadix "${detail.media.title}" (${detail.media.id}): ${links.length} usable link(s)`);

    const candidates = dedupeCandidates(
      links.map((link) => this.toCandidate(link, detail.media.id, target)).filter((c): c is IndexerCandidate => !!c),
    );
    const state: BookmarkState = { mediaId: detail.media.id, seasons: detail.seasons };
    return {
      candidates,
      bookmark: { pageUrl: this.pageUrl(detail.media.id), searchUrl: this.searchUrl(target), state },
    };
  }

  private pageUrl(mediaId: string): string {
    return `${this.siteHost}/media/${mediaId}`;
  }

  private searchUrl(target: IndexerTarget): string {
    const titles = targetTitles(target);
    const [query] = loadixQueries(titles);
    const params = new URLSearchParams({ q: query ?? targetTitle(target) });
    const years = yearRange(titles);
    if (years) {
      params.set('year_from', String(years.from));
      params.set('year_to', String(years.to));
    }
    return `${this.siteHost}/search?${params}`;
  }

  /**
   * Queries in Loadix's own order (French title first), narrowed server-side to the release
   * year, each hit list ranked so the ones carrying one of our titles are looked up before
   * the fuzzy remainder: the budget must never be burnt on look-alikes of the first query
   * before the next query gets its turn.
   */
  private async findMedia(target: IndexerTarget): Promise<LoadixMediaDetail | null> {
    const acceptedTypes = target.kind === 'movie' ? MOVIE_HIT_TYPES : SHOW_HIT_TYPES;
    const titles = targetTitles(target);
    const imdbId = targetImdbId(target);
    const inspected = new Set<string>();
    const years = yearRange(titles);

    for (const query of loadixQueries(titles)) {
      const hits = await this.api.search(query, years);
      const plausible = hits.filter((hit) => !inspected.has(hit.id) && isPlausibleHit(hit, titles, acceptedTypes));
      let fuzzyLeft = FUZZY_LOOKUPS_PER_QUERY;

      for (const { hit, exact } of rankHits(plausible, titles)) {
        if (inspected.size >= MAX_DETAIL_LOOKUPS) {
          LoadixIndexer.logger.debug(`Detail lookup budget exhausted for "${titles.title}" (${imdbId})`);
          return null;
        }
        if (!exact && fuzzyLeft === 0) {
          break;
        }
        fuzzyLeft -= exact ? 0 : 1;
        inspected.add(hit.id);

        const detail = await this.api.getMedia(hit.id);
        if (detail.media.imdbId === imdbId) {
          LoadixIndexer.logger.debug(`Loadix matched "${hit.title}" for query "${query}" (${imdbId})`);
          return detail;
        }
      }
    }

    return null;
  }

  private async findMovieLinks(detail: LoadixMediaDetail): Promise<LoadixLink[]> {
    const links = await this.api.listLinks(detail.media.id, { seasonId: undefined });
    return links.filter(isUsableLink);
  }

  /**
   * One listing per intent season plus one unscoped listing (season & series packs
   * are not attached to a seasonId), deduplicated by link id.
   */
  private async findShowLinks(detail: LoadixMediaDetail, target: ShowTarget): Promise<LoadixLink[]> {
    const intentSeasons = new Set(target.episodes.map((e) => e.season));
    const seasonIds = detail.seasons.filter((s) => intentSeasons.has(s.seasonNumber)).map((s) => s.id);

    const linksById = new Map<string, LoadixLink>();
    for (const seasonId of [undefined, ...seasonIds]) {
      const links = await this.api.listLinks(detail.media.id, { seasonId });
      for (const link of links) {
        linksById.set(link.id, link);
      }
    }

    return [...linksById.values()].filter(
      (link) => isUsableLink(link) && (link.seasonNumber === null || intentSeasons.has(link.seasonNumber)),
    );
  }

  /**
   * Loadix has no per-link URL: every candidate points at the generic media page and
   * the fetchr-grab handshake works off that page. Scope comes from the link's own
   * season/episode fields, more reliable than its free-form `scope` label.
   */
  private toCandidate(link: LoadixLink, mediaId: string, target: IndexerTarget): IndexerCandidate | null {
    const scope = linkScope(link, target);
    if (!scope) {
      return null;
    }
    const sizeBytes = link.sizeBytes ? Number(link.sizeBytes) : NaN;

    return {
      indexerName: this.name,
      url: this.pageUrl(mediaId),
      scope,
      quality: mapQuality(link.quality),
      language: mapLanguage(link.language),
      host: mapHost(link.provider),
      sizeBytes: Number.isFinite(sizeBytes) ? sizeBytes : null,
    };
  }
}

/**
 * A French catalogue: the French title is its key, the original one is searchable too.
 * No "title year" variants: the year goes to the search endpoint as a filter.
 */
function loadixQueries(titles: MediaTitles): string[] {
  return buildSearchQueries([titles.frenchTitle, titles.originalTitle, titles.title], null);
}

function yearRange(titles: MediaTitles): YearRange | null {
  return titles.year ? { from: titles.year - YEAR_TOLERANCE, to: titles.year + YEAR_TOLERANCE } : null;
}

function carriesOneOfTitles(hit: LoadixSearchHit, titles: MediaTitles): boolean {
  const known = [titles.frenchTitle, titles.originalTitle, titles.title];
  return [hit.title, hit.originalTitle, ...(hit.titleAlt ?? [])].some((candidate) =>
    known.some((title) => isSameTitle(candidate, title)),
  );
}

function rankHits(hits: LoadixSearchHit[], titles: MediaTitles): Array<{ hit: LoadixSearchHit; exact: boolean }> {
  return hits
    .map((hit) => ({ hit, exact: carriesOneOfTitles(hit, titles) }))
    .sort((a, b) => Number(b.exact) - Number(a.exact));
}

function linkScope(link: LoadixLink, target: IndexerTarget): CandidateScope | null {
  if (target.kind === 'movie') {
    return { kind: 'movie' };
  }
  if (link.seasonNumber !== null && link.episodeNumber !== null) {
    return { kind: 'episode', season: link.seasonNumber, episode: link.episodeNumber };
  }
  if (link.seasonNumber !== null) {
    return { kind: 'season', season: link.seasonNumber };
  }
  return { kind: 'series' };
}

function isUsableLink(link: LoadixLink): boolean {
  return link.status === 'validated' && link.linkType === 'ddl_url';
}

/** Unknown sizes sort last: a known light release always beats a blind one. */
function isLighter(candidate: IndexerCandidate, incumbent: IndexerCandidate): boolean {
  return candidate.sizeBytes !== null && (incumbent.sizeBytes === null || candidate.sizeBytes < incumbent.sizeBytes);
}

/**
 * Same page URL for every link: collapse candidates that are indistinguishable for the
 * planner, keeping the lightest release so a Blu-Ray pack never shadows a WEB one.
 */
function dedupeCandidates(candidates: IndexerCandidate[]): IndexerCandidate[] {
  const byKey = new Map<string, IndexerCandidate>();
  for (const candidate of candidates) {
    const key = [scopeKey(candidate.scope), candidate.quality, candidate.language, candidate.host].join('|');
    const incumbent = byKey.get(key);
    if (!incumbent || isLighter(candidate, incumbent)) {
      byKey.set(key, candidate);
    }
  }
  return [...byKey.values()];
}

function isPlausibleHit(hit: LoadixSearchHit, media: MediaTitles, acceptedTypes: string[]): boolean {
  if (!acceptedTypes.includes(hit.type) || hit.hasLinks === false) {
    return false;
  }
  if (media.year === null || hit.year === null || hit.year === undefined) {
    return true;
  }
  return Math.abs(hit.year - media.year) <= YEAR_TOLERANCE;
}
