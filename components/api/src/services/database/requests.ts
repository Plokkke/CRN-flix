import { Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Pool } from 'pg';
import { z } from 'zod';

import { withDbRetry } from '@/helpers/db-retry';
import { Emitter } from '@/helpers/events';
import { ListenChannel, ListenHandle, listenWithReconnect } from '@/helpers/sql';
import { MediaTitles } from '@/modules/indexer/contract';
import { MediaEntity } from '@/services/database/medias';
import { UserEntity } from '@/services/database/users';

import { RequestKind } from '../trakt-sync';

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

/** One media of a show (or a movie) as the planner loads it: intent, availability, users. */
export type PlannerStateRow = MediaTitles & {
  mediaId: string;
  imdbId: string;
  seasonNumber: number | null;
  episodeNumber: number | null;
  runtimeMinutes: number | null;
  status: RequestStatus | null;
  userIds: string[];
};

type RequestRecord = {
  media_id: string;
  status: RequestStatus;
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

export class RequestsRepository extends Emitter<RequestEvents> implements OnModuleInit, OnModuleDestroy {
  static readonly logger = new Logger(RequestsRepository.name);

  private listenHandle: ListenHandle | null = null;

  constructor(private readonly pool: Pool) {
    super();
  }

  onModuleInit(): void {
    const channels: ListenChannel[] = [
      {
        channel: 'request_status_changed',
        schema: requestStatusChangedEventMorphing,
        callback: (msg) => this.emit('statusChange', msg as RequestStatusChangedEvent),
      },
      {
        channel: 'request_created',
        schema: requestCreatedEventMorphing,
        callback: (msg) => this.emit('created', msg as RequestCreatedEvent),
      },
      {
        channel: 'user_joined_request',
        schema: userJoinedRequestEventMorphing,
        callback: (msg) => this.emit('userJoined', msg as UserJoinedRequestEvent),
      },
      {
        channel: 'user_left_request',
        schema: userLeftRequestEventMorphing,
        callback: (msg) => this.emit('userLeft', msg as UserLeftRequestEvent),
      },
    ];
    this.listenHandle = listenWithReconnect(this.pool, channels, undefined, 'RequestsRepository');
  }

  async onModuleDestroy(): Promise<void> {
    if (this.listenHandle) {
      await this.listenHandle.close();
      this.listenHandle = null;
    }
  }

  async upsert(
    mediaId: string,
    status: RequestStatus = RequestStatus.Pending,
    downloadJobId: string | null = null,
  ): Promise<RequestEntity> {
    const query = `
      INSERT INTO media_requests (media_id, status, download_job_id)
      VALUES ($1, $2, $3)
      ON CONFLICT (media_id) DO NOTHING
      RETURNING *
    `;
    const { rows } = await withDbRetry(() => this.pool.query<RequestRecord>(query, [mediaId, status, downloadJobId]), {
      label: 'requests.upsert',
    });
    if (!rows.length) {
      return (await this.get(mediaId))!;
    }
    return fromRequestRecord(rows[0]);
  }

  async upsertFulfilled(mediaId: string): Promise<void> {
    await withDbRetry(
      () =>
        this.pool.query(
          `INSERT INTO media_requests (media_id, status)
           VALUES ($1, $2)
           ON CONFLICT (media_id) DO UPDATE SET status = $2, updated_at = NOW()
           WHERE media_requests.status != $2`,
          [mediaId, RequestStatus.Fulfilled],
        ),
      { label: 'requests.upsertFulfilled' },
    );
  }

  async linkDownloadJob(mediaId: string, downloadJobId: string): Promise<void> {
    await withDbRetry(
      () =>
        this.pool.query(`UPDATE media_requests SET download_job_id = $2, updated_at = NOW() WHERE media_id = $1`, [
          mediaId,
          downloadJobId,
        ]),
      { label: 'requests.linkDownloadJob' },
    );
  }

  async fulfillByJobId(downloadJobId: string): Promise<void> {
    await withDbRetry(
      () =>
        this.pool.query(`UPDATE media_requests SET status = $2, updated_at = NOW() WHERE download_job_id = $1`, [
          downloadJobId,
          RequestStatus.Fulfilled,
        ]),
      { label: 'requests.fulfillByJobId' },
    );
  }

  async get(id: string): Promise<RequestEntity | null> {
    const query = `
            SELECT
                json_build_object(
                    'mediaId', request.media_id,
                    'status', request.status,
                    'createdAt', request.created_at,
                    'updatedAt', request.updated_at,
                    'media', json_build_object(
                        'id', media.id,
                        'imdbId', media.imdb_id,
                        'type', media.type,
                        'title', media.title,
                        'originalTitle', media.original_title,
                        'frenchTitle', media.french_title,
                        'originalLanguage', media.original_language,
                        'year', media.year,
                        'seasonNumber', media.season_number,
                        'episodeNumber', media.episode_number,
                        'runtimeMinutes', media.runtime_minutes,
            'traktSlug', media.trakt_slug,
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
                                    'status', u.status,
                                    'createdAt', u.created_at,
                                    'updatedAt', u.updated_at
                                )
                            ) ORDER BY ru.created_at DESC -- Order users within the request
                        ), '[]'::json)
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
    RequestsRepository.logger.debug(`Updating request ${mediaId} status to ${status}`);
    const query = `
      UPDATE media_requests
      SET status = $2, updated_at = NOW()
      WHERE media_id = $1
      RETURNING *
    `;
    const { rows } = await this.pool.query<RequestRecord>(query, [mediaId, status]);
    RequestsRepository.logger.debug(`Request ${mediaId} status updated, NOTIFY should fire`);
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
      `DELETE FROM request_users
       WHERE request_media_id = $1 AND user_id = $2
         AND array_length(array_remove(reasons, $3), 1) IS NULL`,
      [mediaId, userId, reason],
    );
    await this.pool.query(
      `UPDATE request_users SET reasons = array_remove(reasons, $3)
       WHERE request_media_id = $1 AND user_id = $2`,
      [mediaId, userId, reason],
    );
  }

  async listAllWithDetails(): Promise<RequestEntity[]> {
    return this.listWithDetails('', []);
  }

  /** Every request the user takes part in, with media and co-requesters. */
  async listByUserWithDetails(userId: string): Promise<RequestEntity[]> {
    return this.listWithDetails(
      `WHERE EXISTS (SELECT 1 FROM request_users mine WHERE mine.request_media_id = request.media_id AND mine.user_id = $1)`,
      [userId],
    );
  }

  private async listWithDetails(whereClause: string, params: unknown[]): Promise<RequestEntity[]> {
    const query = `
      SELECT
        json_build_object(
          'mediaId', request.media_id,
          'status', request.status,
          'createdAt', request.created_at,
          'updatedAt', request.updated_at,
          'media', json_build_object(
            'id', media.id,
            'imdbId', media.imdb_id,
            'type', media.type,
            'title', media.title,
            'originalTitle', media.original_title,
            'frenchTitle', media.french_title,
            'originalLanguage', media.original_language,
            'year', media.year,
            'seasonNumber', media.season_number,
            'episodeNumber', media.episode_number,
            'runtimeMinutes', media.runtime_minutes,
            'traktSlug', media.trakt_slug,
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
                  'status', u.status,
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
      ${whereClause}
      ORDER BY request.created_at DESC
    `;
    const { rows } = await this.pool.query<{ request: RequestEntity }>(query, params);
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

  // --- Planner state queries ---

  /** Shows (imdb ids) having at least one open (missing/pending) episode request. */
  async listPlannerShowImdbIds(): Promise<string[]> {
    const { rows } = await this.pool.query<{ imdb_id: string }>(
      `SELECT DISTINCT m.imdb_id
       FROM media_requests mr
       JOIN medias m ON m.id = mr.media_id
       WHERE m.type = 'episode' AND m.imdb_id != '' AND mr.status = ANY($1)`,
      [[RequestStatus.Missing, RequestStatus.Pending]],
    );
    return rows.map((row) => row.imdb_id);
  }

  /** Movies (media ids) having an open (missing/pending) request. */
  async listPlannerMovieMediaIds(): Promise<string[]> {
    const { rows } = await this.pool.query<{ media_id: string }>(
      `SELECT mr.media_id
       FROM media_requests mr
       JOIN medias m ON m.id = mr.media_id
       WHERE m.type = 'movie' AND mr.status = ANY($1)`,
      [[RequestStatus.Missing, RequestStatus.Pending]],
    );
    return rows.map((row) => row.media_id);
  }

  /** Every known episode of a show with its request status and requesting users. */
  async getShowPlannerState(imdbId: string): Promise<PlannerStateRow[]> {
    const { rows } = await this.pool.query<PlannerStateRow>(
      `SELECT
         m.id as "mediaId",
         m.imdb_id as "imdbId",
         m.title,
         m.original_title as "originalTitle",
         m.french_title as "frenchTitle",
         m.original_language as "originalLanguage",
         m.year,
         m.season_number as "seasonNumber",
         m.episode_number as "episodeNumber",
         m.runtime_minutes as "runtimeMinutes",
         mr.status,
         COALESCE(
           (SELECT array_agg(ru.user_id) FROM request_users ru WHERE ru.request_media_id = m.id),
           '{}'
         ) as "userIds"
       FROM medias m
       LEFT JOIN media_requests mr ON mr.media_id = m.id
       WHERE m.imdb_id = $1 AND m.type = 'episode'
       ORDER BY m.season_number, m.episode_number`,
      [imdbId],
    );
    return rows;
  }

  async getMoviePlannerState(mediaId: string): Promise<PlannerStateRow | null> {
    const { rows } = await this.pool.query<PlannerStateRow>(
      `SELECT
         m.id as "mediaId",
         m.imdb_id as "imdbId",
         m.title,
         m.original_title as "originalTitle",
         m.french_title as "frenchTitle",
         m.original_language as "originalLanguage",
         m.year,
         m.season_number as "seasonNumber",
         m.episode_number as "episodeNumber",
         m.runtime_minutes as "runtimeMinutes",
         mr.status,
         COALESCE(
           (SELECT array_agg(ru.user_id) FROM request_users ru WHERE ru.request_media_id = m.id),
           '{}'
         ) as "userIds"
       FROM medias m
       LEFT JOIN media_requests mr ON mr.media_id = m.id
       WHERE m.id = $1 AND m.type = 'movie'`,
      [mediaId],
    );
    return rows[0] ?? null;
  }

  async updateStatusesBulk(mediaIds: string[], status: RequestStatus): Promise<void> {
    if (mediaIds.length === 0) {
      return;
    }
    await this.pool.query(
      `UPDATE media_requests SET status = $2, updated_at = NOW() WHERE media_id = ANY($1) AND status != $2`,
      [mediaIds, status],
    );
  }

  async listByStatuses(statuses: RequestStatus[]): Promise<RequestEntity[]> {
    const query = `
      SELECT
        json_build_object(
          'mediaId', request.media_id,
          'status', request.status,
          'createdAt', request.created_at,
          'updatedAt', request.updated_at,
          'media', json_build_object(
            'id', media.id,
            'imdbId', media.imdb_id,
            'type', media.type,
            'title', media.title,
            'originalTitle', media.original_title,
            'frenchTitle', media.french_title,
            'originalLanguage', media.original_language,
            'year', media.year,
            'seasonNumber', media.season_number,
            'episodeNumber', media.episode_number,
            'runtimeMinutes', media.runtime_minutes,
            'traktSlug', media.trakt_slug,
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
