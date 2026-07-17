import { Logger } from '@nestjs/common';

import { Indexer, IndexerCandidate } from '@/modules/indexer/contract';
import { Host, Language, Quality } from '@/modules/indexer/preferences';
import { MediaInfos } from '@/services/database/medias';

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

function sanitizeForSearch(str: string): string {
  return str
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

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

  async find(media: MediaInfos): Promise<IndexerCandidate[]> {
    if (!media.imdbId) {
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

  private async findTitle(media: MediaInfos): Promise<HydrackerTitle | null> {
    const queries = this.buildSearchQueries(media);

    for (const query of queries) {
      const candidates = await this.searchAndFilter(query, media);
      const match = candidates.find((c) => c.imdb_id === media.imdbId);
      if (match) {
        return match;
      }
    }

    return null;
  }

  private buildSearchQueries(media: MediaInfos): string[] {
    const seen = new Set<string>();
    const queries: string[] = [];

    const addQuery = (raw: string | null | undefined): void => {
      if (!raw) {
        return;
      }
      const sanitized = sanitizeForSearch(raw);
      if (sanitized && !seen.has(sanitized)) {
        seen.add(sanitized);
        queries.push(sanitized);
      }
    };

    addQuery(media.title);
    addQuery(media.originalTitle);

    if (media.year) {
      addQuery(`${media.title} ${media.year}`);
      if (media.originalTitle) {
        addQuery(`${media.originalTitle} ${media.year}`);
      }
    }

    return queries;
  }

  private async searchAndFilter(query: string, media: MediaInfos): Promise<HydrackerTitle[]> {
    const results = await this.api.search(query);
    const expectedSeries = media.type === 'episode';

    return results.filter(
      (title) => title.type && !MEDIA_TYPES_FILTER.has(title.type) && title.is_series === expectedSeries,
    );
  }

  private async checkAvailability(titleId: number, media: MediaInfos): Promise<string | null> {
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

    for (const quality of QUALITY_IDS) {
      const available = await this.api.listLinks(titleId, { ...baseOptions, quality });
      if (available) {
        return this.buildDownloadUrl(titleId, quality, media);
      }
    }

    return null;
  }

  private buildDownloadUrl(titleId: number, quality: number, media: MediaInfos): string {
    const isEpisode = media.type === 'episode' && media.seasonNumber !== null && media.episodeNumber !== null;
    const filters = buildFiltersBase64(quality, isEpisode ? media.episodeNumber : null);
    const basePath = `${this.siteHost}/titles/${titleId}`;

    if (isEpisode) {
      return `${basePath}/season/${media.seasonNumber}/episode/${media.episodeNumber}/download?filters=${filters}`;
    }

    return `${basePath}/download?filters=${filters}`;
  }
}
