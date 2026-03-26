import { Logger, OnModuleInit } from '@nestjs/common';
import { Pool } from 'pg';
import { z } from 'zod';

import { Emitter } from '@/helpers/events';
import { listen } from '@/helpers/sql';
import { MediaEntity } from '@/services/database/medias';
import { UserEntity } from '@/services/database/users';

import { RequestKind } from '../sync';

export enum RequestStatus {
  Pending = 'pending',
  Fulfilled = 'fulfilled',
  Missing = 'missing',
  Rejected = 'rejected',
}
export const requestStatusSchema = z.enum(RequestStatus);

export type RequestEntity = {
  mediaId: string;
  status: RequestStatus;
  createdAt: Date;
  updatedAt: Date;
  taskId: string | null;
  darkiworldTitleId: number | null;
  darkiworldUrl: string | null;
  media?: MediaEntity;
  userRequests?: RequestUserEntity[];
};

export type RequestUserEntity = {
  requestId: string;
  userId: string;
  reasons: string[];
  createdAt: Date;
  updatedAt: Date;
  user?: UserEntity;
};

export type SyncRequestSnapshot = {
  mediaId: string;
  imdbId: string;
  seasonNumber: number | null;
  episodeNumber: number | null;
  userReasons: { userId: string; reasons: string[] }[];
};

type RequestRecord = {
  media_id: string;
  status: RequestStatus;
  thread_id: string | null;
  darkiworld_title_id: number | null;
  darkiworld_url: string | null;
  created_at: Date;
  updated_at: Date;
};

type RequestUserRecord = {
  request_id: string;
  user_id: string;
  reasons: string[];
  created_at: Date;
  updated_at: Date;
};

function fromRequestRecord(record: RequestRecord): RequestEntity {
  return {
    mediaId: record.media_id,
    status: record.status,
    taskId: record.thread_id,
    darkiworldTitleId: record.darkiworld_title_id,
    darkiworldUrl: record.darkiworld_url,
    createdAt: record.created_at,
    updatedAt: record.updated_at,
  };
}

function fromRequestUserRecord(record: RequestUserRecord): RequestUserEntity {
  return {
    requestId: record.request_id,
    userId: record.user_id,
    reasons: record.reasons,
    createdAt: record.created_at,
    updatedAt: record.updated_at,
  };
}

const stringParseMorphing = z.string().transform((payload): unknown => JSON.parse(payload));

const requestStatusChangedEventSchema = z.object({
  requestId: z.string(),
  oldStatus: requestStatusSchema,
  newStatus: requestStatusSchema,
});
export type RequestStatusChangedEvent = z.infer<typeof requestStatusChangedEventSchema>;
const requestStatusChangedEventMorphing = stringParseMorphing.pipe(requestStatusChangedEventSchema);

const requestCreatedEventSchema = z.object({
  requestId: z.string(),
});
export type RequestCreatedEvent = z.infer<typeof requestCreatedEventSchema>;
const requestCreatedEventMorphing = stringParseMorphing.pipe(requestCreatedEventSchema);
const userJoinedRequestEventSchema = z.object({
  requestId: z.string(),
  userId: z.string(),
});
export type UserJoinedRequestEvent = z.infer<typeof userJoinedRequestEventSchema>;
const userJoinedRequestEventMorphing = stringParseMorphing.pipe(userJoinedRequestEventSchema);

const userLeftRequestEventSchema = z.object({
  requestId: z.string(),
  userId: z.string(),
});
export type UserLeftRequestEvent = z.infer<typeof userLeftRequestEventSchema>;
const userLeftRequestEventMorphing = stringParseMorphing.pipe(userLeftRequestEventSchema);

export type RequestEvents = {
  statusChange: RequestStatusChangedEvent;
  created: RequestCreatedEvent;
  userJoined: UserJoinedRequestEvent;
  userLeft: UserLeftRequestEvent;
};

const LISTENING_MAP: {
  channel: string;
  schema: z.ZodType<RequestEvents[keyof RequestEvents]>;
  event: keyof RequestEvents;
}[] = [
  {
    channel: 'request_status_changed',
    schema: requestStatusChangedEventMorphing,
    event: 'statusChange',
  },
  {
    channel: 'request_created',
    schema: requestCreatedEventMorphing,
    event: 'created',
  },
  {
    channel: 'user_joined_request',
    schema: userJoinedRequestEventMorphing,
    event: 'userJoined',
  },
  {
    channel: 'user_left_request',
    schema: userLeftRequestEventMorphing,
    event: 'userLeft',
  },
];

export class RequestsRepository extends Emitter<RequestEvents> implements OnModuleInit {
  static readonly logger = new Logger(RequestsRepository.name);

  constructor(private readonly pool: Pool) {
    super();
  }

  async onModuleInit(): Promise<void> {
    const client = await this.pool.connect();

    for (const { channel, schema, event } of LISTENING_MAP) {
      listen(client, channel, schema, (msg: z.infer<typeof schema>) => {
        this.emit(event, msg);
      });
    }

    client.release();
  }

  async create(mediaId: string): Promise<RequestEntity> {
    const query = `
      INSERT INTO media_requests (media_id)
      VALUES ($1)
      ON CONFLICT (media_id) DO NOTHING
      RETURNING *
    `;
    const { rows } = await this.pool.query<RequestRecord>(query, [mediaId]);
    if (!rows.length) {
      return (await this.get(mediaId))!;
    }
    return fromRequestRecord(rows[0]);
  }

  async get(id: string): Promise<RequestEntity | null> {
    const query = `
            SELECT 
                json_build_object(
                    'mediaId', request.media_id,
                    'status', request.status,
                    'taskId', request.thread_id,
                    'darkiworldTitleId', request.darkiworld_title_id,
                    'darkiworldUrl', request.darkiworld_url,
                    'createdAt', request.created_at,
                    'updatedAt', request.updated_at,
                    'media', json_build_object(
                        'id', media.id,
                        'imdbId', media.imdb_id,
                        'type', media.type,
                        'title', media.title,
                        'year', media.year,
                        'seasonNumber', media.season_number,
                        'episodeNumber', media.episode_number,
                        'createdAt', media.created_at,
                        'updatedAt', media.updated_at
                    ),
                    'userRequests', (
                        SELECT json_agg(
                            json_build_object(
                                'requestId', ru.request_media_id,
                                'userId', ru.user_id,
                                'reasons', ru.reasons,
                                'createdAt', ru.created_at,
                                'updatedAt', ru.updated_at,
                                'user', json_build_object(
                                    'id', u.id,
                                    'name', u.name,
                                    'jellyfinId', u.jellyfin_id,
                                    'messagingKey', u.messaging_key,
                                    'messagingId', u.messaging_id,
                                    'approvalMessageId', u.approval_message_id,
                                    'createdAt', u.created_at,
                                    'updatedAt', u.updated_at
                                )
                            ) ORDER BY ru.created_at DESC -- Order users within the request
                        )
                        FROM request_users ru
                        LEFT JOIN users u ON u.id = ru.user_id
                        WHERE ru.request_media_id = request.media_id
                    )
                ) as request
            FROM media_requests request
            JOIN medias media ON media.id = request.media_id
            WHERE request.media_id = $1
            GROUP BY request.media_id, media.id -- Group by primary keys to ensure one row per request
    `;
    const { rows } = await this.pool.query<{ request: RequestEntity }>(query, [id]);
    const request = rows[0]?.request ?? null;
    return request;
  }

  async updateStatus(mediaId: string, status: RequestStatus): Promise<RequestEntity> {
    const query = `
      UPDATE media_requests
      SET status = $2, updated_at = NOW()
      WHERE media_id = $1
      RETURNING *
    `;
    const { rows } = await this.pool.query<RequestRecord>(query, [mediaId, status]);
    return fromRequestRecord(rows[0]);
  }

  async removeRequest(id: string): Promise<void> {
    const query = 'DELETE FROM media_requests WHERE media_id = $1';
    await this.pool.query(query, [id]);
  }

  async listUsers(mediaId: string): Promise<RequestUserEntity[]> {
    const query = `
      SELECT *
      FROM request_users
      WHERE request_media_id = $1
      ORDER BY created_at DESC
    `;
    const { rows } = await this.pool.query<RequestUserRecord>(query, [mediaId]);
    return rows.map(fromRequestUserRecord);
  }

  async getByMediaId(mediaId: string): Promise<RequestEntity | null> {
    const query = `
      SELECT * FROM media_requests
      WHERE media_id = $1
    `;
    const { rows } = await this.pool.query<RequestRecord>(query, [mediaId]);
    return rows.length > 0 ? fromRequestRecord(rows[0]) : null;
  }

  async setUserRequestReason(mediaId: string, userId: string, reason: RequestKind): Promise<RequestUserEntity> {
    const query = `
      INSERT INTO request_users (request_media_id, user_id, reasons)
      VALUES ($1, $2, ARRAY[$3]::VARCHAR(64)[]) -- Initialize reasons with the new reason as a single-element array
      ON CONFLICT (request_media_id, user_id)
      DO UPDATE SET reasons = array_append(request_users.reasons, $3)
      WHERE NOT (request_users.reasons @> ARRAY[$3]::VARCHAR(64)[]) -- Append only if the reason doesn't exist
      RETURNING *
    `;
    const { rows } = await this.pool.query<RequestUserRecord>(query, [mediaId, userId, reason]);

    return fromRequestUserRecord(rows[0]);
  }

  async setUserRequestReasons(mediaId: string, userId: string, reasons: Set<RequestKind>): Promise<RequestUserEntity> {
    const query = `
      INSERT INTO request_users (request_media_id, user_id, reasons)
      VALUES ($1, $2, $3::VARCHAR(64)[])
      ON CONFLICT (request_media_id, user_id)
      DO UPDATE SET reasons = $3::VARCHAR(64)[]
      RETURNING *
    `;
    const { rows } = await this.pool.query<RequestUserRecord>(query, [mediaId, userId, Array.from(reasons)]);
    return fromRequestUserRecord(rows[0]);
  }

  async removeUserRequest(mediaId: string, userId: string): Promise<void> {
    const query = `
      DELETE FROM request_users
      WHERE request_media_id = $1 AND user_id = $2
    `;
    await this.pool.query(query, [mediaId, userId]);
  }

  async removeUserRequestReason(mediaId: string, userId: string, reason: string): Promise<void> {
    await this.pool.query(
      `UPDATE request_users SET reasons = array_remove(reasons, $3)
       WHERE request_media_id = $1 AND user_id = $2`,
      [mediaId, userId, reason],
    );
    await this.pool.query(
      `DELETE FROM request_users
       WHERE request_media_id = $1 AND user_id = $2 AND array_length(reasons, 1) IS NULL`,
      [mediaId, userId],
    );
  }

  async createWithStatus(
    mediaId: string,
    status: RequestStatus,
    darkiworldTitleId: number | null,
    darkiworldUrl: string | null,
  ): Promise<RequestEntity> {
    const query = `
      INSERT INTO media_requests (media_id, status, darkiworld_title_id, darkiworld_url)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (media_id) DO NOTHING
      RETURNING *
    `;
    const { rows } = await this.pool.query<RequestRecord>(query, [mediaId, status, darkiworldTitleId, darkiworldUrl]);
    if (!rows.length) {
      return (await this.get(mediaId))!;
    }
    return fromRequestRecord(rows[0]);
  }

  async listAllWithDetails(): Promise<RequestEntity[]> {
    const query = `
      SELECT
        json_build_object(
          'mediaId', request.media_id,
          'status', request.status,
          'taskId', request.thread_id,
          'darkiworldTitleId', request.darkiworld_title_id,
          'darkiworldUrl', request.darkiworld_url,
          'createdAt', request.created_at,
          'updatedAt', request.updated_at,
          'media', json_build_object(
            'id', media.id,
            'imdbId', media.imdb_id,
            'type', media.type,
            'title', media.title,
            'year', media.year,
            'seasonNumber', media.season_number,
            'episodeNumber', media.episode_number,
            'createdAt', media.created_at,
            'updatedAt', media.updated_at
          ),
          'userRequests', (
            SELECT COALESCE(json_agg(
              json_build_object(
                'requestId', ru.request_media_id,
                'userId', ru.user_id,
                'reasons', ru.reasons,
                'createdAt', ru.created_at,
                'updatedAt', ru.updated_at,
                'user', json_build_object(
                  'id', u.id,
                  'name', u.name,
                  'jellyfinId', u.jellyfin_id,
                  'messagingKey', u.messaging_key,
                  'messagingId', u.messaging_id,
                  'approvalMessageId', u.approval_message_id,
                  'createdAt', u.created_at,
                  'updatedAt', u.updated_at
                )
              ) ORDER BY ru.created_at DESC
            ), '[]'::json)
            FROM request_users ru
            LEFT JOIN users u ON u.id = ru.user_id
            WHERE ru.request_media_id = request.media_id
          )
        ) as request
      FROM media_requests request
      JOIN medias media ON media.id = request.media_id
      ORDER BY request.created_at DESC
    `;
    const { rows } = await this.pool.query<{ request: RequestEntity }>(query);
    return rows.map((row) => row.request);
  }

  async listSyncSnapshot(
    desiredCompositeKeys: { imdbId: string; seasonNumber: number | null; episodeNumber: number | null }[],
    syncedUserIds: string[],
  ): Promise<SyncRequestSnapshot[]> {
    const query = `
      SELECT
        mr.media_id as "mediaId",
        m.imdb_id as "imdbId",
        m.season_number as "seasonNumber",
        m.episode_number as "episodeNumber",
        COALESCE(
          json_agg(
            json_build_object('userId', ru.user_id, 'reasons', ru.reasons)
          ) FILTER (WHERE ru.user_id IS NOT NULL),
          '[]'::json
        ) as "userReasons"
      FROM media_requests mr
      JOIN medias m ON m.id = mr.media_id
      LEFT JOIN request_users ru ON ru.request_media_id = mr.media_id
      WHERE (m.imdb_id, COALESCE(m.season_number, -1), COALESCE(m.episode_number, -1))
            IN (SELECT * FROM unnest($1::text[], $2::int[], $3::int[]))
         OR EXISTS (
           SELECT 1 FROM request_users sub
           WHERE sub.request_media_id = mr.media_id
             AND sub.user_id = ANY($4)
         )
      GROUP BY mr.media_id, m.imdb_id, m.season_number, m.episode_number
    `;
    const imdbIds = desiredCompositeKeys.map((k) => k.imdbId);
    const seasonNumbers = desiredCompositeKeys.map((k) => k.seasonNumber ?? -1);
    const episodeNumbers = desiredCompositeKeys.map((k) => k.episodeNumber ?? -1);
    const { rows } = await this.pool.query<SyncRequestSnapshot>(query, [
      imdbIds,
      seasonNumbers,
      episodeNumbers,
      syncedUserIds,
    ]);
    return rows;
  }

  async attachTask(mediaId: string, taskId: string): Promise<void> {
    const query = `
      UPDATE media_requests
      SET thread_id = $2
      WHERE media_id = $1
    `;
    await this.pool.query(query, [mediaId, taskId]);
  }

  async findRequestsWithoutTasks(): Promise<RequestEntity[]> {
    const query = `
      SELECT 
        mr.media_id,
        mr.status,
        mr.thread_id,
        mr.created_at,
        mr.updated_at,
        m.id as media_id,
        m.imdb_id,
        m.type,
        m.title,
        m.year,
        m.season_number,
        m.episode_number,
        m.created_at as media_created_at,
        m.updated_at as media_updated_at,
        COALESCE(
          json_agg(
            json_build_object(
              'requestId', ru.request_media_id,
              'userId', ru.user_id,
              'reasons', ru.reasons,
              'createdAt', ru.created_at,
              'updatedAt', ru.updated_at,
              'user', json_build_object(
                'id', u.id,
                'name', u.name,
                'jellyfinId', u.jellyfin_id,
                'messagingKey', u.messaging_key,
                'messagingId', u.messaging_id,
                'createdAt', u.created_at,
                'updatedAt', u.updated_at
              )
            )
          ) FILTER (WHERE ru.user_id IS NOT NULL),
          '[]'::json
        ) as user_requests
      FROM media_requests mr
      JOIN medias m ON mr.media_id = m.id
      LEFT JOIN request_users ru ON mr.media_id = ru.request_media_id
      LEFT JOIN users u ON ru.user_id = u.id
      WHERE mr.thread_id IS NULL
      GROUP BY mr.media_id, mr.status, mr.thread_id, mr.darkiworld_title_id, mr.darkiworld_url, mr.created_at, mr.updated_at,
               m.id, m.imdb_id, m.type, m.title, m.year, m.season_number, m.episode_number, m.created_at, m.updated_at
      ORDER BY mr.created_at DESC
    `;

    const { rows } = await this.pool.query(query);

    return rows.map((row) => ({
      mediaId: row.media_id,
      status: row.status,
      taskId: row.thread_id,
      darkiworldTitleId: row.darkiworld_title_id,
      darkiworldUrl: row.darkiworld_url,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      media: {
        id: row.media_id,
        imdbId: row.imdb_id,
        type: row.type,
        title: row.title,
        year: row.year,
        seasonNumber: row.season_number,
        episodeNumber: row.episode_number,
        createdAt: row.media_created_at,
        updatedAt: row.media_updated_at,
      },
      userRequests: row.user_requests || [],
    }));
  }

  async setDarkiworldInfo(mediaId: string, titleId: number, url: string | null): Promise<void> {
    const query = `
      UPDATE media_requests
      SET darkiworld_title_id = $2, darkiworld_url = $3
      WHERE media_id = $1
    `;
    await this.pool.query(query, [mediaId, titleId, url]);
  }

  async listByStatuses(statuses: RequestStatus[]): Promise<RequestEntity[]> {
    const query = `
      SELECT
        json_build_object(
          'mediaId', request.media_id,
          'status', request.status,
          'taskId', request.thread_id,
          'darkiworldTitleId', request.darkiworld_title_id,
          'darkiworldUrl', request.darkiworld_url,
          'createdAt', request.created_at,
          'updatedAt', request.updated_at,
          'media', json_build_object(
            'id', media.id,
            'imdbId', media.imdb_id,
            'type', media.type,
            'title', media.title,
            'year', media.year,
            'seasonNumber', media.season_number,
            'episodeNumber', media.episode_number,
            'createdAt', media.created_at,
            'updatedAt', media.updated_at
          )
        ) as request
      FROM media_requests request
      JOIN medias media ON media.id = request.media_id
      WHERE request.status = ANY($1)
      ORDER BY request.created_at DESC
    `;
    const { rows } = await this.pool.query<{ request: RequestEntity }>(query, [statuses]);
    return rows.map((row) => row.request);
  }
}
