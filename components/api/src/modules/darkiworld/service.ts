import { Logger } from '@nestjs/common';

import { MediaInfos } from '@/services/database/medias';

import { DarkiworldApi } from './api';
import { DarkiworldAvailability, DarkiworldTitle } from './types';

const MEDIA_TYPES_FILTER = new Set(['music', 'emulation', 'ebooks', 'logiciels', 'jeux']);
const QUALITY_IDS = [86, 83, 50];
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

function buildFiltersBase64(quality: number): string {
  const filters = [
    { key: 'id_host', value: HOST_1FICHIER, valueKey: HOST_1FICHIER, isInactive: false },
    { key: 'qualite', value: quality, isInactive: false, operator: '=', valueKey: quality },
    { key: 'langues', value: LANG_TRUEFRENCH, isInactive: false, operator: 'has', valueKey: LANG_TRUEFRENCH },
  ];
  return Buffer.from(JSON.stringify(filters)).toString('base64');
}

export class DarkiworldService {
  private static readonly logger = new Logger(DarkiworldService.name);

  constructor(
    private readonly api: DarkiworldApi,
    private readonly siteHost: string,
  ) {}

  async find(media: MediaInfos): Promise<DarkiworldAvailability> {
    if (!media.imdbId) {
      return { available: false, title: null, downloadUrl: null };
    }

    const title = await this.findTitle(media);

    if (!title) {
      DarkiworldService.logger.debug(`No Darkiworld match for "${media.title}" (${media.imdbId})`);
      return { available: false, title: null, downloadUrl: null };
    }

    const downloadUrl = await this.checkAvailability(title.id, media);
    DarkiworldService.logger.log(
      `Darkiworld "${title.name}" (${title.id}): ${downloadUrl ? 'available' : 'not available'}`,
    );

    return { available: downloadUrl !== null, title, downloadUrl };
  }

  private async findTitle(media: MediaInfos): Promise<DarkiworldTitle | null> {
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

  private async searchAndFilter(query: string, media: MediaInfos): Promise<DarkiworldTitle[]> {
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
    const filters = buildFiltersBase64(quality);
    const basePath = `${this.siteHost}/titles/${titleId}`;

    if (media.type === 'episode' && media.seasonNumber !== null && media.episodeNumber !== null) {
      return `${basePath}/season/${media.seasonNumber}/episode/${media.episodeNumber}/download?filters=${filters}`;
    }

    return `${basePath}/download?filters=${filters}`;
  }
}
