import * as path from 'path';

import { Logger } from '@nestjs/common';
import { parse as parseTorrentTitle } from 'parse-torrent-title';
import { Pool } from 'pg';

import { IdentifiedMedia, MetadataSource } from '@crn-flix/contracts';

import { MediasRepository, MediaType } from '@/services/database/medias';
import { RequestsRepository, RequestStatus } from '@/services/database/requests';

export type ParsedMedia = {
  title: string;
  year?: number;
  season?: number;
  episode?: number;
  isEpisode: boolean;
};

/** What a file was identified as; `title` is refined to the canonical one before naming. */
export type IdentificationResult = {
  imdbId: string;
  title: string;
  year: number | null;
  mediaType: 'movie' | 'episode';
  seasonNumber: number | null;
  episodeNumber: number | null;
  episodeNumberEnd: number | null;
  mediaRequestId: string;
};

export class MediaIdentifierService {
  private static readonly logger = new Logger(MediaIdentifierService.name);

  constructor(
    private readonly metadata: MetadataSource,
    private readonly pool: Pool,
    private readonly medias: MediasRepository,
    private readonly requests: RequestsRepository,
  ) {}

  parseFilename(filePath: string): ParsedMedia {
    const filename = path.basename(filePath, path.extname(filePath));
    const parsed = parseTorrentTitle(filename);

    return {
      title: parsed.title ?? filename,
      year: parsed.year,
      season: parsed.season,
      episode: parsed.episode,
      isEpisode: parsed.season !== undefined && parsed.episode !== undefined,
    };
  }

  async identify(filePath: string, downloadJobId: string): Promise<IdentificationResult | null> {
    const parsed = this.parseFilename(filePath);
    MediaIdentifierService.logger.log(
      `Parsed "${path.basename(filePath)}" → title="${parsed.title}", year=${parsed.year}, S${parsed.season}E${parsed.episode}`,
    );

    if (!parsed.title) {
      MediaIdentifierService.logger.warn(`Could not parse title from: ${filePath}`);
      return null;
    }

    const identification = await this.identifyFromParsed(parsed);
    return identification ? this.toResult(identification, parsed, downloadJobId) : null;
  }

  async identifyWithImdbId(
    filePath: string,
    imdbId: string,
    downloadJobId: string,
  ): Promise<IdentificationResult | null> {
    const parsed = this.parseFilename(filePath);
    MediaIdentifierService.logger.log(`Manual identification for "${path.basename(filePath)}" with IMDb ID ${imdbId}`);

    const identification = await this.identifyImdbId(imdbId);
    if (!identification) {
      MediaIdentifierService.logger.warn(`No ${this.metadata.name} result for IMDb ID: ${imdbId}`);
      return null;
    }
    MediaIdentifierService.logger.log(
      `Resolved IMDb ${imdbId} → "${identification.title}" (${identification.year}) [${identification.kind}]`,
    );
    return this.toResult(identification, parsed, downloadJobId);
  }

  /** What an admin-given IMDb id is: a movie or a show, with its title and year. */
  async identifyImdbId(imdbId: string): Promise<IdentifiedMedia | null> {
    const described = await this.metadata.describe(imdbId);
    const title = described.title ?? described.originalTitle;
    if (!described.kind || !title) {
      return null;
    }
    return { imdbId, kind: described.kind, title, originalTitle: described.originalTitle, year: described.year };
  }

  async identifyFromParsed(parsed: ParsedMedia): Promise<IdentifiedMedia | null> {
    if (!parsed.title) {
      return null;
    }
    return this.metadata.identify({
      kind: parsed.isEpisode ? 'show' : 'movie',
      title: parsed.title,
      year: parsed.year ?? null,
    });
  }

  async identifyFromRequest(
    filePath: string,
    requestId: string,
    downloadJobId: string,
  ): Promise<IdentificationResult | null> {
    const request = await this.requests.get(requestId);
    if (!request?.media) {
      MediaIdentifierService.logger.warn(`Request ${requestId} not found for identifyFromRequest`);
      return null;
    }

    const media = request.media;
    const parsed = this.parseFilename(filePath);

    await this.requests.linkDownloadJob(requestId, downloadJobId);
    MediaIdentifierService.logger.log(`Linked request ${requestId} to job ${downloadJobId} via metadata`);

    return {
      imdbId: media.imdbId,
      title: media.title,
      year: media.year,
      mediaType: media.type as 'movie' | 'episode',
      seasonNumber: parsed.season ?? media.seasonNumber,
      episodeNumber: parsed.episode ?? media.episodeNumber,
      episodeNumberEnd: null,
      mediaRequestId: requestId,
    };
  }

  private async toResult(
    identification: IdentifiedMedia,
    parsed: ParsedMedia,
    downloadJobId: string,
  ): Promise<IdentificationResult> {
    const seasonNumber = parsed.season ?? null;
    const episodeNumber = parsed.episode ?? null;
    return {
      imdbId: identification.imdbId,
      title: identification.title,
      year: identification.year,
      mediaType: identification.kind === 'movie' ? 'movie' : 'episode',
      seasonNumber,
      episodeNumber,
      episodeNumberEnd: null,
      mediaRequestId: await this.ensureMediaRequest(identification, seasonNumber, episodeNumber, downloadJobId),
    };
  }

  private async ensureMediaRequest(
    identification: IdentifiedMedia,
    seasonNumber: number | null,
    episodeNumber: number | null,
    downloadJobId: string,
  ): Promise<string> {
    const existingRequestId = await this.findMatchingRequest(identification.imdbId, seasonNumber, episodeNumber);

    if (existingRequestId) {
      await this.requests.linkDownloadJob(existingRequestId, downloadJobId);
      MediaIdentifierService.logger.log(`Linked request ${existingRequestId} to job ${downloadJobId}`);
      return existingRequestId;
    }

    // Identification may match a localized title; the database keeps the canonical (English) one.
    const titles = await this.metadata.describe(identification.imdbId);
    const media = await this.medias.upsert({
      imdbId: identification.imdbId,
      type: identification.kind === 'movie' ? MediaType.Movie : MediaType.Episode,
      title: titles.title ?? identification.title,
      originalTitle: titles.originalTitle ?? identification.originalTitle,
      frenchTitle: titles.frenchTitle,
      originalLanguage: titles.originalLanguage,
      year: identification.year,
      seasonNumber,
      episodeNumber,
      runtimeMinutes: null,
    });

    const request = await this.requests.upsert(media.id, RequestStatus.Fulfilled, downloadJobId);
    MediaIdentifierService.logger.log(
      `Created spontaneous media+request for "${identification.title}" (${identification.imdbId})`,
    );
    return request.mediaId;
  }

  private async findMatchingRequest(
    imdbId: string,
    seasonNumber: number | null,
    episodeNumber: number | null,
  ): Promise<string | null> {
    const query = `
      SELECT mr.media_id
      FROM media_requests mr
      JOIN medias m ON mr.media_id = m.id
      WHERE m.imdb_id = $1
        AND mr.status IN ('pending', 'missing')
        AND ($2::int IS NULL OR m.season_number = $2)
        AND ($3::int IS NULL OR m.episode_number = $3)
      LIMIT 1
    `;

    const result = await this.pool.query(query, [imdbId, seasonNumber, episodeNumber]);
    return result.rows[0]?.media_id ?? null;
  }
}
