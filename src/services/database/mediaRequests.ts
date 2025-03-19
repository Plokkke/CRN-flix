import { Pool } from 'pg';

import { upsertQuery } from '@/helpers/sql';
import { log } from 'console';

export type MediaType = 'movie' | 'show' | 'season' | 'episode';
export type MediaStatus = 'missing' | 'overaged';

export type MediaRequestEntity = {
  id: string;
  imdbId: string;
  status: MediaStatus;
  type: MediaType;
  title: string;
  year: number | null;
  seasonNumber: number | null;
  episodeNumber: number | null;
  threadId: string | null;
  userIds: string[];
  createdAt: Date;
  updatedAt: Date;
};

export type MediaRequestCreateInfos = Omit<MediaRequestEntity, 'id' | 'createdAt' | 'updatedAt'>;

type MediaRequestRecord = {
  id: string;
  imdb_id: string;
  status: MediaStatus;
  type: MediaType;
  title: string;
  year: number | null;
  season_number: number | null;
  episode_number: number | null;
  thread_id: string | null;
  created_at: Date;
  updated_at: Date;
};

type MediaRequestColumns = keyof MediaRequestRecord;
const COLUMNS = [
  'id',
  'imdb_id',
  'status',
  'type',
  'title',
  'year',
  'season_number',
  'episode_number',
  'thread_id',
  'created_at',
  'updated_at',
] as const satisfies MediaRequestColumns[];

type MediaRequestListRecord = MediaRequestRecord & {
  user_ids: string[] | null;
};

function fromListRecord(record: MediaRequestListRecord): MediaRequestEntity {
  return {
    id: record.id,
    imdbId: record.imdb_id,
    status: record.status,
    type: record.type,
    title: record.title,
    year: record.year,
    seasonNumber: record.season_number,
    episodeNumber: record.episode_number,
    threadId: record.thread_id,
    userIds: record.user_ids || [],
    createdAt: record.created_at,
    updatedAt: record.updated_at,
  };
}

export class MediaRequestRepository {
  constructor(private readonly pool: Pool) {}

  async list(): Promise<MediaRequestEntity[]> {
    const client = await this.pool.connect();
    try {
      const { rows } = await client.query<MediaRequestListRecord>(`
        SELECT 
          ${COLUMNS.map((column) => `mr.${column}`).join(',')},
          ARRAY_AGG(mru.user_id) FILTER (WHERE mru.user_id IS NOT NULL) AS user_ids
        FROM 
          media_requests mr
        LEFT JOIN 
          media_requests_users mru ON mr.id = mru.media_request_id
        GROUP BY 
          mr.id
      `);
      return rows.map(fromListRecord);
    } finally {
      client.release();
    }
  }

  async upsert(infos: MediaRequestCreateInfos): Promise<MediaRequestEntity> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      const insertRecord: Partial<Record<MediaRequestColumns, unknown>> = {
        imdb_id: infos.imdbId,
        status: infos.status,
        type: infos.type,
        title: infos.title,
        year: infos.year,
        season_number: infos.seasonNumber,
        episode_number: infos.episodeNumber,
        thread_id: infos.threadId,
      };
      const mediaQuery = upsertQuery('media_requests', insertRecord, ['imdb_id', 'COALESCE(season_number, -1)', 'COALESCE(episode_number, -1)']);
      const {
        rows: [mediaRecord],
      } = await client.query<MediaRequestRecord>(mediaQuery, Object.values(insertRecord));

      // TODO delete existing joins
      for (const userId of infos.userIds) {
        const joinRecord = {
          media_request_id: mediaRecord.id,
          user_id: userId,
        };
        const userQuery = upsertQuery('media_requests_users', joinRecord, ['media_request_id', 'user_id']);
        await client.query(userQuery, Object.values(joinRecord));
      }

      await client.query('COMMIT');

      return fromListRecord({ ...mediaRecord, user_ids: infos.userIds });
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Error creating media request:', error);
      throw error;
    } finally {
      client.release();
    }
  }
}
