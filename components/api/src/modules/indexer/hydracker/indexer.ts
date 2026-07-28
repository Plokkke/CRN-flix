import { Logger } from '@nestjs/common';

import { Indexer, IndexerCandidate, IndexerMedia } from '@/modules/indexer/contract';
import { EnginePreferences, Host, isAllowed, Language, Quality } from '@/modules/indexer/preferences';
import { buildSearchQueries } from '@/modules/indexer/query';

import { HydrackerApi } from './api';
import { HydrackerTitle } from './schemas';

const MEDIA_TYPES_FILTER = new Set(['music', 'emulation', 'ebooks', 'logiciels', 'jeux']);

const QUALITIES = {
  HDLIGHT_1080P_X265: 86,
  WEB_1080P_X265: 83,
  WEB_1080P_LIGHT: 94,
  HDLIGHT_1080P: 50,
  WEB_1080P: 55,
  HD_1080P: 52,
  HDTV_1080P: 62,
} as const;

// Preference order: first available wins. All map to Quality.HD_1080P.
const QUALITY_IDS: number[] = [
  QUALITIES.HDLIGHT_1080P_X265,
  QUALITIES.WEB_1080P_X265,
  QUALITIES.WEB_1080P_LIGHT,
  QUALITIES.HDLIGHT_1080P,
  QUALITIES.WEB_1080P,
  QUALITIES.HD_1080P,
  QUALITIES.HDTV_1080P,
];

const LANG_TRUEFRENCH = 8;
const HOST_1FICHIER = 5;

function buildFiltersBase64(quality: number, episodeNumber: number | null): string {
  const filters: Record<string, unknown>[] = [
    { key: 'id_host', value: HOST_1FICHIER, valueKey: HOST_1FICHIER, isInactive: false },
    { key: 'qualite', value: quality, isInactive: false, operator: '=', valueKey: quality },
    { key: 'langues', value: LANG_TRUEFRENCH, isInactive: false, operator: 'has', valueKey: LANG_TRUEFRENCH },
  ];
  if (episodeNumber !== null) {
    filters.push({ key: 'episode', value: episodeNumber, operator: '=' });
  }
  return Buffer.from(JSON.stringify(filters)).toString('base64');
}

export class HydrackerIndexer implements Indexer {
  private static readonly logger = new Logger(HydrackerIndexer.name);

  readonly name = 'hydracker';

  private readonly siteHost: string;

  constructor(
    private readonly api: HydrackerApi,
    siteHost: string,
  ) {
    this.siteHost = siteHost.replace(/\/+$/, '');
  }

  async find(media: IndexerMedia, prefs: EnginePreferences): Promise<IndexerCandidate[]> {
    if (!media.imdbId || !HydrackerIndexer.canSatisfy(prefs)) {
      return [];
    }

    const title = await this.findTitle(media);
    if (!title) {
      HydrackerIndexer.logger.debug(`No Hydracker match for "${media.title}" (${media.imdbId})`);
      return [];
    }

    const downloadUrl = await this.checkAvailability(title.id, media);
    HydrackerIndexer.logger.log(
      `Hydracker "${title.name}" (${title.id}): ${downloadUrl ? 'available' : 'not available'}`,
    );

    if (!downloadUrl) {
      return [];
    }

    return [
      {
        indexerName: this.name,
        url: downloadUrl,
        quality: Quality.HD_1080P,
        language: Language.TRUEFRENCH,
        host: Host.ONE_FICHIER,
        sizeBytes: null,
      },
    ];
  }

  private async findTitle(media: IndexerMedia): Promise<HydrackerTitle | null> {
    const queries = buildSearchQueries(media);

    for (const query of queries) {
      const candidates = await this.searchAndFilter(query, media);
      const match = candidates.find((c) => c.imdb_id === media.imdbId);
      if (match) {
        return match;
      }
    }

    return null;
  }

  private async searchAndFilter(query: string, media: IndexerMedia): Promise<HydrackerTitle[]> {
    const results = await this.api.search(query);
    const expectedSeries = media.type === 'episode';

    return results.filter(
      (title) => title.type && !MEDIA_TYPES_FILTER.has(title.type) && title.is_series === expectedSeries,
    );
  }

  /** Hydracker only ever yields 1080p truefrench 1fichier candidates: skip everything when excluded. */
  private static canSatisfy(prefs: EnginePreferences): boolean {
    return (
      isAllowed(prefs.allowedQualities, Quality.HD_1080P) &&
      isAllowed(prefs.allowedLanguages, Language.TRUEFRENCH) &&
      isAllowed(prefs.allowedHosts, Host.ONE_FICHIER)
    );
  }

  private async checkAvailability(titleId: number, media: IndexerMedia): Promise<string | null> {
    const baseOptions = {
      lang: LANG_TRUEFRENCH,
      host: HOST_1FICHIER,
      ...(media.type === 'episode' &&
        media.seasonNumber !== null &&
        media.episodeNumber !== null && {
          season: media.seasonNumber,
          episode: media.episodeNumber,
        }),
    };

    // One unfiltered probe first: when nothing exists at all (the common case),
    // it saves the whole quality-by-quality refinement below.
    const anyAvailable = await this.api.listLinks(titleId, baseOptions);
    if (!anyAvailable) {
      return null;
    }

    for (const quality of QUALITY_IDS) {
      const available = await this.api.listLinks(titleId, { ...baseOptions, quality });
      if (available) {
        return this.buildDownloadUrl(titleId, quality, media);
      }
    }

    return null;
  }

  private buildDownloadUrl(titleId: number, quality: number, media: IndexerMedia): string {
    const isEpisode = media.type === 'episode' && media.seasonNumber !== null && media.episodeNumber !== null;
    const filters = buildFiltersBase64(quality, isEpisode ? media.episodeNumber : null);
    const basePath = `${this.siteHost}/titles/${titleId}`;

    if (isEpisode) {
      return `${basePath}/season/${media.seasonNumber}/episode/${media.episodeNumber}/download?filters=${filters}`;
    }

    return `${basePath}/download?filters=${filters}`;
  }
}
