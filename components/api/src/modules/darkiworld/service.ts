import { Logger } from '@nestjs/common';

import { MediaInfos } from '@/services/database/medias';

import { DarkiworldApi } from './api';
import { DarkiworldAvailability, DarkiworldTitle } from './types';

const MEDIA_TYPES_FILTER = new Set(['music', 'emulation', 'ebooks', 'logiciels', 'jeux']);
const QUALITY_IDS = [86, 83, 50];
const LANG_TRUEFRENCH = 8;
const HOST_1FICHIER = 5;

function normalize(str: string): string {
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

export class DarkiworldService {
  private static readonly logger = new Logger(DarkiworldService.name);

  constructor(private readonly api: DarkiworldApi) {}

  async find(media: MediaInfos): Promise<DarkiworldAvailability> {
    const title = await this.findTitle(media);

    if (!title) {
      DarkiworldService.logger.debug(`No Darkiworld match for "${media.title}" (${media.imdbId})`);
      return { available: false, title: null };
    }

    const available = await this.checkAvailability(title.id, media);
    DarkiworldService.logger.log(
      `Darkiworld "${title.name}" (${title.id}): ${available ? 'available' : 'not available'}`,
    );

    return { available, title };
  }

  private async findTitle(media: MediaInfos): Promise<DarkiworldTitle | null> {
    const candidates = await this.searchAndFilter(media.title, media);

    const byId = this.matchById(candidates, media);
    if (byId) {
      return byId;
    }

    const byName = this.matchByNameYear(candidates, media);
    if (byName) {
      return byName;
    }

    const firstResult = candidates[0];
    if (firstResult?.original_title && firstResult.original_title !== media.title) {
      const altCandidates = await this.searchAndFilter(firstResult.original_title, media);
      const altById = this.matchById(altCandidates, media);
      if (altById) {
        return altById;
      }

      const altByName = this.matchByNameYear(altCandidates, media);
      if (altByName) {
        return altByName;
      }
    }

    return null;
  }

  private async searchAndFilter(query: string, media: MediaInfos): Promise<DarkiworldTitle[]> {
    const results = await this.api.search(query);
    const expectedSeries = media.type === 'episode';

    return results.filter((title) => !MEDIA_TYPES_FILTER.has(title.type) && title.is_series === expectedSeries);
  }

  private matchById(candidates: DarkiworldTitle[], media: MediaInfos): DarkiworldTitle | null {
    if (media.imdbId) {
      const match = candidates.find((c) => c.imdb_id === media.imdbId);
      if (match) {
        return match;
      }
    }

    return null;
  }

  private matchByNameYear(candidates: DarkiworldTitle[], media: MediaInfos): DarkiworldTitle | null {
    const normalizedTitle = normalize(media.title);

    return (
      candidates.find((c) => {
        const nameMatch =
          normalize(c.name) === normalizedTitle || normalize(c.original_title ?? '') === normalizedTitle;
        const yearMatch = !media.year || !c.year || media.year === c.year;
        return nameMatch && yearMatch;
      }) ?? null
    );
  }

  private async checkAvailability(titleId: number, media: MediaInfos): Promise<boolean> {
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
        return true;
      }
    }

    return false;
  }
}
