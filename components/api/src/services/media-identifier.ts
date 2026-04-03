import * as path from 'path';

import { Logger } from '@nestjs/common';
import { parse as parseTorrentTitle } from 'parse-torrent-title';
import { Pool } from 'pg';

import { MediasRepository, MediaType } from '@/services/database/medias';
import { RequestsRepository, RequestStatus } from '@/services/database/requests';

import { TmdbApiService, TmdbIdentification } from '../modules/tmdb/tmdb';

export type ParsedMedia = {
  title: string;
  year?: number;
  season?: number;
  episode?: number;
  isEpisode: boolean;
};

export type IdentificationResult = {
  tmdbId: number;
  imdbId: string;
  title: string;
  year: number | null;
  mediaType: 'movie' | 'episode';
  seasonNumber: number | null;
  episodeNumber: number | null;
  mediaRequestId: string;
};

export class MediaIdentifierService {
  private static readonly logger = new Logger(MediaIdentifierService.name);

  constructor(
    private readonly tmdb: TmdbApiService,
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
      isEpisode: parsed.season !== undefined || parsed.episode !== undefined,
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

    const identification = parsed.isEpisode ? await this.identifyEpisode(parsed) : await this.identifyMovie(parsed);

    if (!identification || !identification.imdbId) {
      return null;
    }

    const mediaRequestId = await this.ensureMediaRequest(
      identification,
      parsed.season ?? null,
      parsed.episode ?? null,
      downloadJobId,
    );

    return {
      ...identification,
      imdbId: identification.imdbId,
      seasonNumber: parsed.season ?? null,
      episodeNumber: parsed.episode ?? null,
      mediaRequestId,
    };
  }

  async identifyWithImdbId(
    filePath: string,
    imdbId: string,
    downloadJobId: string,
  ): Promise<IdentificationResult | null> {
    const parsed = this.parseFilename(filePath);
    MediaIdentifierService.logger.log(`Manual identification for "${path.basename(filePath)}" with IMDb ID ${imdbId}`);

    const { movies, tvShows } = await this.tmdb.findByImdbId(imdbId);

    let identification: TmdbIdentification | null = null;

    if (parsed.isEpisode && tvShows.length > 0) {
      const show = tvShows[0];
      const year = show.first_air_date ? parseInt(show.first_air_date.substring(0, 4), 10) : null;
      identification = {
        tmdbId: show.id,
        imdbId,
        title: show.name,
        originalTitle: show.original_name,
        year,
        mediaType: 'episode',
      };
    } else if (movies.length > 0) {
      const movie = movies[0];
      const year = movie.release_date ? parseInt(movie.release_date.substring(0, 4), 10) : null;
      identification = {
        tmdbId: movie.id,
        imdbId,
        title: movie.title,
        originalTitle: movie.original_title,
        year,
        mediaType: 'movie',
      };
    } else if (tvShows.length > 0) {
      const show = tvShows[0];
      const year = show.first_air_date ? parseInt(show.first_air_date.substring(0, 4), 10) : null;
      identification = {
        tmdbId: show.id,
        imdbId,
        title: show.name,
        originalTitle: show.original_name,
        year,
        mediaType: 'episode',
      };
    }

    if (!identification) {
      MediaIdentifierService.logger.warn(`No TMDB results for IMDb ID: ${imdbId}`);
      return null;
    }

    MediaIdentifierService.logger.log(
      `Resolved IMDb ${imdbId} → "${identification.title}" (${identification.year}) [${identification.mediaType}]`,
    );

    const mediaRequestId = await this.ensureMediaRequest(
      identification,
      parsed.season ?? null,
      parsed.episode ?? null,
      downloadJobId,
    );

    return {
      ...identification,
      imdbId,
      seasonNumber: parsed.season ?? null,
      episodeNumber: parsed.episode ?? null,
      mediaRequestId,
    };
  }

  private async ensureMediaRequest(
    identification: TmdbIdentification,
    seasonNumber: number | null,
    episodeNumber: number | null,
    downloadJobId: string,
  ): Promise<string> {
    const existingRequestId = await this.findMatchingRequest(identification.imdbId!, seasonNumber, episodeNumber);

    if (existingRequestId) {
      await this.requests.linkDownloadJob(existingRequestId, downloadJobId);
      MediaIdentifierService.logger.log(`Linked request ${existingRequestId} to job ${downloadJobId}`);
      return existingRequestId;
    }

    const media = await this.medias.upsert({
      imdbId: identification.imdbId!,
      type: identification.mediaType as MediaType,
      title: identification.title,
      originalTitle: identification.originalTitle,
      year: identification.year,
      seasonNumber,
      episodeNumber,
    });

    const request = await this.requests.upsert(media.id, RequestStatus.Fulfilled, null, null, downloadJobId);
    MediaIdentifierService.logger.log(
      `Created spontaneous media+request for "${identification.title}" (${identification.imdbId})`,
    );
    return request.mediaId;
  }

  private async identifyMovie(parsed: ParsedMedia): Promise<TmdbIdentification | null> {
    const results = await this.tmdb.searchMovie(parsed.title, parsed.year);
    if (results.length === 0) {
      MediaIdentifierService.logger.warn(`No TMDb movie results for: "${parsed.title}" (${parsed.year})`);
      return null;
    }

    const best = results[0];
    const releaseYear = best.release_date ? parseInt(best.release_date.substring(0, 4), 10) : null;

    if (parsed.year && releaseYear && Math.abs(parsed.year - releaseYear) > 1) {
      MediaIdentifierService.logger.warn(
        `Year mismatch for "${parsed.title}": expected ${parsed.year}, got ${releaseYear}`,
      );
      if (results.length > 1) {
        const altMatch = results.find((r) => {
          const y = r.release_date ? parseInt(r.release_date.substring(0, 4), 10) : null;
          return y !== null && parsed.year !== undefined && Math.abs(parsed.year - y) <= 1;
        });
        if (altMatch) {
          return this.resolveMovieIdentification(altMatch);
        }
      }
    }

    return this.resolveMovieIdentification(best);
  }

  private async resolveMovieIdentification(movie: {
    id: number;
    title: string;
    original_title: string;
    release_date: string;
  }): Promise<TmdbIdentification> {
    const externalIds = await this.tmdb.getMovieExternalIds(movie.id);
    const year = movie.release_date ? parseInt(movie.release_date.substring(0, 4), 10) : null;

    MediaIdentifierService.logger.log(
      `Identified movie: "${movie.title}" (${year}) — TMDb: ${movie.id}, IMDb: ${externalIds.imdb_id}`,
    );

    return {
      tmdbId: movie.id,
      imdbId: externalIds.imdb_id,
      title: movie.title,
      originalTitle: movie.original_title,
      year,
      mediaType: 'movie',
    };
  }

  private async identifyEpisode(parsed: ParsedMedia): Promise<TmdbIdentification | null> {
    const results = await this.tmdb.searchTv(parsed.title, parsed.year);
    if (results.length === 0) {
      MediaIdentifierService.logger.warn(`No TMDb TV results for: "${parsed.title}" (${parsed.year})`);
      return null;
    }

    const best = results[0];
    const externalIds = await this.tmdb.getTvExternalIds(best.id);
    const year = best.first_air_date ? parseInt(best.first_air_date.substring(0, 4), 10) : null;

    MediaIdentifierService.logger.log(
      `Identified series: "${best.name}" (${year}) S${parsed.season}E${parsed.episode} — TMDb: ${best.id}, IMDb: ${externalIds.imdb_id}`,
    );

    return {
      tmdbId: best.id,
      imdbId: externalIds.imdb_id,
      title: best.name,
      originalTitle: best.original_name,
      year,
      mediaType: 'episode',
    };
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
