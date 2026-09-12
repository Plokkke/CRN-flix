import { Logger } from '@nestjs/common';
import { Pool } from 'pg';

import { IndexerMedia, MediaType } from '@/modules/indexer/contract';

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
    year: record.year,
    seasonNumber: record.season_number,
    episodeNumber: record.episode_number,
    runtimeMinutes: record.runtime_minutes,
    traktSlug: record.trakt_slug,
    createdAt: record.created_at,
    updatedAt: record.updated_at,
  };
}

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
      INSERT INTO medias (imdb_id, type, title, original_title, year, season_number, episode_number, runtime_minutes, trakt_slug)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      ON CONFLICT (imdb_id, COALESCE(season_number, -1), COALESCE(episode_number, -1))
      DO UPDATE SET
        title = $3,
        original_title = COALESCE($4, medias.original_title),
        year = $5,
        runtime_minutes = COALESCE($8, medias.runtime_minutes),
        trakt_slug = COALESCE($9, medias.trakt_slug)
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
    ]);

    if (rows.length) {
      return fromMediaRecord(rows[0]);
    }

    return (await this.findByInfos(infos))!;
  }

  async updateImdbId(mediaId: string, imdbId: string): Promise<void> {
    await this.pool.query(`UPDATE medias SET imdb_id = $2, updated_at = NOW() WHERE id = $1`, [mediaId, imdbId]);
  }
}
