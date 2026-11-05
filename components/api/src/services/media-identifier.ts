import * as path from 'path';

import { Logger } from '@nestjs/common';
import { parse as parseTorrentTitle } from 'parse-torrent-title';
import { Pool } from 'pg';

import { IdentifiedMedia, IdentitySubmission, MediaKind, MediaMetadata, MetadataSource } from '@crn-flix/contracts';

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

/** A media an admin designated, with what the metadata source says about it. */
export type DesignatedMedia = { media: IdentifiedMedia; metadata: MediaMetadata };

/** `reason` says where it is stuck and what to give next. */
export type SubmissionResolution = { ok: true; designated: DesignatedMedia } | { ok: false; reason: string };

const refused = (reason: string): SubmissionResolution => ({ ok: false, reason });

function designate(imdbId: string, kind: MediaKind, metadata: MediaMetadata): SubmissionResolution {
  const title = metadata.title ?? metadata.originalTitle ?? metadata.frenchTitle ?? imdbId;
  return {
    ok: true,
    designated: {
      media: { imdbId, kind, title, originalTitle: metadata.originalTitle, year: metadata.year },
      metadata,
    },
  };
}

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
    const resolution = await this.resolveSubmission({ imdbId, reference: null });
    if (!resolution.ok) {
      MediaIdentifierService.logger.warn(`IMDb ${imdbId} not resolved: ${resolution.reason}`);
      return null;
    }
    return this.identifyAs(filePath, resolution.designated, downloadJobId);
  }

  async identifyAs(
    filePath: string,
    designated: DesignatedMedia,
    downloadJobId: string,
  ): Promise<IdentificationResult> {
    const { media } = designated;
    MediaIdentifierService.logger.log(
      `Identified "${path.basename(filePath)}" as IMDb ${media.imdbId} → "${media.title}" (${media.year}) [${media.kind}]`,
    );
    return this.toResult(media, this.parseFilename(filePath), downloadJobId, designated.metadata);
  }

  /**
   * What an admin designated, read from the metadata source only — never guessed. An IMDb id
   * alone needs the source to link it to a page; a page reference alone needs the page to
   * link an IMDb id; both together pin the page to that id (unless it links another one).
   */
  async resolveSubmission({ imdbId, reference }: IdentitySubmission): Promise<SubmissionResolution> {
    if (reference) {
      return this.resolveReference(reference, imdbId);
    }
    if (!imdbId) {
      return refused('Ni IMDb ID ni fiche fournis');
    }
    const metadata = await this.metadata.describe(imdbId);
    if (!metadata.kind) {
      return refused(
        `${this.sourceLabel} ne connaît pas ${imdbId} (aucune fiche liée) : répondre avec l'URL de la fiche ${this.sourceLabel}`,
      );
    }
    return designate(imdbId, metadata.kind, metadata);
  }

  private async resolveReference(reference: string, imdbId: string | null): Promise<SubmissionResolution> {
    const page = await this.metadata.describeReference(reference);
    if (!page) {
      return refused(`Fiche ${this.sourceLabel} ${reference} introuvable`);
    }
    if (imdbId && page.imdbId && page.imdbId !== imdbId) {
      return refused(`La fiche ${page.pageUrl} est liée à ${page.imdbId}, pas à ${imdbId}`);
    }
    const resolvedImdbId = imdbId ?? page.imdbId;
    if (!resolvedImdbId) {
      return refused(`La fiche ${page.pageUrl} n'a pas d'IMDb ID : répondre avec l'IMDb ID (tt…) ou l'URL IMDb`);
    }
    return designate(resolvedImdbId, page.kind, page);
  }

  private get sourceLabel(): string {
    return this.metadata.name.toUpperCase();
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
    metadata?: MediaMetadata,
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
      mediaRequestId: await this.ensureMediaRequest(
        identification,
        seasonNumber,
        episodeNumber,
        downloadJobId,
        metadata,
      ),
    };
  }

  private async ensureMediaRequest(
    identification: IdentifiedMedia,
    seasonNumber: number | null,
    episodeNumber: number | null,
    downloadJobId: string,
    metadata?: MediaMetadata,
  ): Promise<string> {
    const existingRequestId = await this.findMatchingRequest(identification.imdbId, seasonNumber, episodeNumber);

    if (existingRequestId) {
      await this.requests.linkDownloadJob(existingRequestId, downloadJobId);
      MediaIdentifierService.logger.log(`Linked request ${existingRequestId} to job ${downloadJobId}`);
      return existingRequestId;
    }

    // Identification may match a localized title; the database keeps the canonical (English) one.
    const titles = metadata ?? (await this.metadata.describe(identification.imdbId));
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
