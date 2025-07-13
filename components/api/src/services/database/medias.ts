import { Logger } from '@nestjs/common';
import { Pool } from 'pg';

export const MEDIA_TYPE = ['movie', 'episode'] as const;
export type MediaType = (typeof MEDIA_TYPE)[number];

export type MediaEntity = {
  id: string;
  imdbId: string;
  type: MediaType;
  title: string;
  year: number | null;
  seasonNumber: number | null;
  episodeNumber: number | null;
  createdAt: Date;
  updatedAt: Date;
};

export type MediaInfos = Omit<MediaEntity, 'id' | 'createdAt' | 'updatedAt'>;

type MediaRecord = {
  id: string;
  imdb_id: string;
  type: MediaType;
  title: string;
  year: number | null;
  season_number: number | null;
  episode_number: number | null;
  created_at: Date;
  updated_at: Date;
};

function fromMediaRecord(record: MediaRecord): MediaEntity {
  return {
    id: record.id,
    imdbId: record.imdb_id,
    type: record.type,
    title: record.title,
    year: record.year,
    seasonNumber: record.season_number,
    episodeNumber: record.episode_number,
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

  async create(infos: MediaInfos): Promise<MediaEntity> {
    const query = `
      INSERT INTO medias (imdb_id, type, title, year, season_number, episode_number)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (imdb_id, COALESCE(season_number, -1), COALESCE(episode_number, -1))
      DO UPDATE SET title = $3, year = $4
      RETURNING *
    `;
    const { rows } = await this.pool.query<MediaRecord>(query, [
      infos.imdbId,
      infos.type,
      infos.title,
      infos.year,
      infos.seasonNumber,
      infos.episodeNumber,
    ]);

    if (rows.length) {
      return fromMediaRecord(rows[0]);
    }

    return (await this.findByInfos(infos))!;
  }

  async setAvailable(media: MediaInfos): Promise<void> {
    const mediaEntity = await this.create(media);

    const updateQuery = `
      UPDATE media_requests
      SET status = 'fulfilled'
      WHERE media_id = $1
        AND status IN ('pending', 'missing')
    `;
    await this.pool.query(updateQuery, [mediaEntity.id]);
  }
}
