import { Logger } from '@nestjs/common';
import { Pool } from 'pg';

import { IndexerMedia, MediaTitles, MediaType } from '@/modules/indexer/contract';

export { MediaType };

/** Trakt's slug is engine metadata (direct links), not part of the indexer contract. */
export type MediaInfos = IndexerMedia & { traktSlug?: string | null };

export type MediaEntity = MediaInfos & {
  id: string;
  traktSlug: string | null;
  createdAt: Date;
  updatedAt: Date;
};

type MediaRecord = {
  id: string;
  imdb_id: string;
  type: MediaType;
  title: string;
  original_title: string | null;
  french_title: string | null;
  original_language: string | null;
  year: number | null;
  season_number: number | null;
  episode_number: number | null;
  runtime_minutes: number | null;
  trakt_slug: string | null;
  created_at: Date;
  updated_at: Date;
};

function fromMediaRecord(record: MediaRecord): MediaEntity {
  return {
    id: record.id,
    imdbId: record.imdb_id,
    type: record.type,
    title: record.title,
    originalTitle: record.original_title,
    frenchTitle: record.french_title,
    originalLanguage: record.original_language,
    year: record.year,
    seasonNumber: record.season_number,
    episodeNumber: record.episode_number,
    runtimeMinutes: record.runtime_minutes,
    traktSlug: record.trakt_slug,
    createdAt: record.created_at,
    updatedAt: record.updated_at,
  };
}

/** What subscribers and admins read: the French title when known, the English one otherwise. */
export function displayTitle(media: Pick<MediaTitles, 'title' | 'frenchTitle'>): string {
  return media.frenchTitle ?? media.title;
}

/** Titles resolved from TMDB; null fields leave the stored value untouched. */
export type MediaTitlesPatch = { [K in Exclude<keyof MediaTitles, 'year'>]?: string | null };

export function isSameMedia(a: MediaInfos, b: MediaInfos): boolean {
  return (
    a.imdbId === b.imdbId &&
    a.type === b.type &&
    a.seasonNumber === b.seasonNumber &&
    a.episodeNumber === b.episodeNumber
  );
}

export class MediasRepository {
  static readonly logger = new Logger(MediasRepository.name);

  constructor(private readonly pool: Pool) {}

  async list(): Promise<MediaEntity[]> {
    const query = `
      SELECT *
      FROM medias
      ORDER BY created_at DESC
    `;
    const { rows } = await this.pool.query<MediaRecord>(query);
    return rows.map(fromMediaRecord);
  }

  async get(id: string): Promise<MediaEntity | null> {
    const query = `
      SELECT *
      FROM medias
      WHERE id = $1
    `;
    const { rows } = await this.pool.query<MediaRecord>(query, [id]);
    return rows.length > 0 ? fromMediaRecord(rows[0]) : null;
  }

  async findByInfos(infos: MediaInfos): Promise<MediaEntity | null> {
    const query = `
      SELECT *
      FROM medias
      WHERE imdb_id = $1
      AND type = $2
      AND (season_number IS NULL AND $3::integer IS NULL OR season_number = $3)
      AND (episode_number IS NULL AND $4::integer IS NULL OR episode_number = $4)
    `;
    const { rows } = await this.pool.query<MediaRecord>(query, [infos.imdbId, infos.seasonNumber, infos.episodeNumber]);
    return rows.length > 0 ? fromMediaRecord(rows[0]) : null;
  }

  async upsert(infos: MediaInfos): Promise<MediaEntity> {
    const query = `
      INSERT INTO medias (imdb_id, type, title, original_title, year, season_number, episode_number, runtime_minutes, trakt_slug, french_title, original_language)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      ON CONFLICT (imdb_id, COALESCE(season_number, -1), COALESCE(episode_number, -1))
      DO UPDATE SET
        title = $3,
        original_title = COALESCE($4, medias.original_title),
        year = $5,
        runtime_minutes = COALESCE($8, medias.runtime_minutes),
        trakt_slug = COALESCE($9, medias.trakt_slug),
        french_title = COALESCE($10, medias.french_title),
        original_language = COALESCE($11, medias.original_language)
      RETURNING *
    `;
    const { rows } = await this.pool.query<MediaRecord>(query, [
      infos.imdbId,
      infos.type,
      infos.title,
      infos.originalTitle,
      infos.year,
      infos.seasonNumber,
      infos.episodeNumber,
      infos.runtimeMinutes,
      infos.traktSlug ?? null,
      infos.frenchTitle,
      infos.originalLanguage,
    ]);

    if (rows.length) {
      return fromMediaRecord(rows[0]);
    }

    return (await this.findByInfos(infos))!;
  }

  /** Every row of the title (all episodes of a show share the imdb id) gets the resolved names. */
  async updateTitles(imdbId: string, titles: MediaTitlesPatch): Promise<void> {
    await this.pool.query(
      `UPDATE medias
       SET title = COALESCE($2, title),
           original_title = COALESCE($3, original_title),
           french_title = COALESCE($4, french_title),
           original_language = COALESCE($5, original_language)
       WHERE imdb_id = $1`,
      [imdbId, titles.title, titles.originalTitle, titles.frenchTitle, titles.originalLanguage],
    );
  }

  async listImdbIdsWithoutFrenchTitle(limit: number): Promise<string[]> {
    const { rows } = await this.pool.query<{ imdb_id: string }>(
      `SELECT DISTINCT imdb_id FROM medias WHERE french_title IS NULL AND imdb_id <> '' LIMIT $1`,
      [limit],
    );
    return rows.map((row) => row.imdb_id);
  }

  async updateImdbId(mediaId: string, imdbId: string): Promise<void> {
    await this.pool.query(`UPDATE medias SET imdb_id = $2, updated_at = NOW() WHERE id = $1`, [mediaId, imdbId]);
  }
}
