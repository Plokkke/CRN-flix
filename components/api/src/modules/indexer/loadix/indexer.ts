import { Logger } from '@nestjs/common';

import { Indexer, IndexerCandidate, IndexerMedia, MediaType } from '@/modules/indexer/contract';
import { buildSearchQueries } from '@/modules/indexer/query';

import { LoadixApi } from './api';
import { mapHost, mapLanguage, mapQuality } from './mapping';
import { LoadixLink, LoadixMediaDetail, LoadixSearchHit } from './schemas';

/** Matching costs one detail fetch per plausible hit; cap them so one find() stays cheap. */
const MAX_DETAIL_LOOKUPS = 5;

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

  async find(media: IndexerMedia): Promise<IndexerCandidate[]> {
    if (!media.imdbId) {
      return [];
    }

    const match = await this.findMedia(media);
    if (!match) {
      LoadixIndexer.logger.debug(`No Loadix match for "${media.title}" (${media.imdbId})`);
      return [];
    }

    const links = await this.findLinks(match, media);
    LoadixIndexer.logger.log(`Loadix "${match.media.title}" (${match.media.id}): ${links.length} usable link(s)`);

    return links.map((link) => this.toCandidate(link, match.media.id));
  }

  private async findMedia(media: IndexerMedia): Promise<LoadixMediaDetail | null> {
    const expectedType = media.type === MediaType.Episode ? 'series' : 'movie';
    const inspected = new Set<string>();

    for (const query of buildSearchQueries(media)) {
      const hits = await this.api.search(query);

      for (const hit of hits.filter((h) => isPlausibleHit(h, media, expectedType))) {
        if (inspected.has(hit.id)) {
          continue;
        }
        if (inspected.size >= MAX_DETAIL_LOOKUPS) {
          LoadixIndexer.logger.debug(`Detail lookup budget exhausted for "${media.title}" (${media.imdbId})`);
          return null;
        }
        inspected.add(hit.id);

        const detail = await this.api.getMedia(hit.id);
        if (detail.media.imdbId === media.imdbId) {
          return detail;
        }
      }
    }

    return null;
  }

  private async findLinks(detail: LoadixMediaDetail, media: IndexerMedia): Promise<LoadixLink[]> {
    const isEpisode = media.type === MediaType.Episode;

    let seasonId: string | undefined;
    if (isEpisode) {
      seasonId = detail.seasons.find((season) => season.seasonNumber === media.seasonNumber)?.id;
      if (!seasonId) {
        return [];
      }
    }

    const links = await this.api.listLinks(detail.media.id, { seasonId });
    return links.filter(
      (link) =>
        link.status === 'validated' &&
        link.linkType === 'ddl_url' &&
        (!isEpisode || link.episodeNumber === media.episodeNumber),
    );
  }

  private toCandidate(link: LoadixLink, mediaId: string): IndexerCandidate {
    const sizeBytes = link.sizeBytes ? Number(link.sizeBytes) : NaN;

    return {
      indexerName: this.name,
      url: `${this.siteHost}/media/${mediaId}`,
      quality: mapQuality(link.quality, link.releaseGroup ?? null),
      language: mapLanguage(link.language),
      host: mapHost(link.provider),
      sizeBytes: Number.isFinite(sizeBytes) ? sizeBytes : null,
    };
  }
}

function isPlausibleHit(hit: LoadixSearchHit, media: IndexerMedia, expectedType: string): boolean {
  if (hit.type !== expectedType || hit.hasLinks === false) {
    return false;
  }
  if (media.year === null || hit.year === null || hit.year === undefined) {
    return true;
  }
  return Math.abs(hit.year - media.year) <= 1;
}
