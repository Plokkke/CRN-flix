import { Logger, OnModuleInit } from '@nestjs/common';
import { Pool } from 'pg';
import { z, ZodSchema, ZodTypeDef } from 'zod';

import { Emitter } from '@/helpers/events';
import { listen } from '@/helpers/sql';
import { isSameMedia, MediaEntity, MediaInfos, MediasRepository } from '@/services/database/medias';
import { UserEntity } from '@/services/database/users';
import { RequestKind } from '@/services/sync';

export const REQUEST_STATUS = ['pending', 'fulfilled', 'missing', 'rejected', 'canceled'] as const;
export const requestStatusSchema = z.enum(REQUEST_STATUS);
export type RequestStatus = z.infer<typeof requestStatusSchema>;

export type RequestEntity = {
  mediaId: string;
  status: RequestStatus;
  threadId: string | null;
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

type RequestRecord = {
  media_id: string;
  status: RequestStatus;
  thread_id: string | null;
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
    threadId: record.thread_id,
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
  schema: ZodSchema<RequestEvents[keyof RequestEvents], ZodTypeDef, string>;
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

  constructor(
    private readonly pool: Pool,
    private readonly mediasRepository: MediasRepository,
  ) {
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

  async listByUserAndKind(userId: string, kind: RequestKind): Promise<RequestEntity[]> {
    const query = `
            SELECT 
                json_build_object(
                    'mediaId', request.media_id,
                    'status', request.status,
                    'threadId', request.thread_id,
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
                            )
                        )
                        FROM request_users ru
                        LEFT JOIN users u ON u.id = ru.user_id
                        WHERE ru.request_media_id = request.media_id
                    )
                ) as request
            FROM media_requests request
            JOIN medias media ON media.id = request.media_id
            LEFT JOIN request_users ru ON ru.request_media_id = request.media_id
            LEFT JOIN users u ON u.id = ru.user_id
            WHERE u.id = $1 AND array_position(ru.reasons, $2) IS NOT NULL
            GROUP BY request.media_id, request.status, request.thread_id, request.created_at, request.updated_at,
            media.id, media.imdb_id, media.type, media.title, media.year, media.season_number, media.episode_number,
            media.created_at, media.updated_at
            ORDER BY request.created_at DESC
    `;
    const { rows } = await this.pool.query<{ request: RequestEntity }>(query, [userId, kind]);
    return rows.map((row) => row.request);
  }

  async get(id: string): Promise<RequestEntity | null> {
    const query = `
            SELECT 
                json_build_object(
                    'mediaId', request.media_id,
                    'status', request.status,
                    'threadId', request.thread_id,
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
    return rows[0]?.request ?? null;
  }

  async getByThreadId(threadId: string): Promise<RequestEntity | null> {
    const query = `
      SELECT *
      FROM media_requests
      WHERE thread_id = $1
    `;
    const { rows } = await this.pool.query<RequestRecord>(query, [threadId]);
    return rows.length > 0 ? fromRequestRecord(rows[0]) : null;
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

  async attachThread(mediaId: string, threadId: string): Promise<RequestEntity> {
    const query = `
      UPDATE media_requests
      SET thread_id = $2, updated_at = NOW()
      WHERE media_id = $1
      RETURNING *
    `;
    const { rows } = await this.pool.query<RequestRecord>(query, [mediaId, threadId]);
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

  async createUserRequest(mediaInfos: MediaInfos, userId: string, reason: string): Promise<RequestUserEntity> {
    const mediaEntity = await this.mediasRepository.create(mediaInfos);

    const request = await this.create(mediaEntity.id);

    return this.setUserRequestReason(request.mediaId, userId, reason);
  }

  async setUserRequestReason(mediaId: string, userId: string, reason: string): Promise<RequestUserEntity> {
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

  async setUserRequestReasons(mediaId: string, userId: string, reasons: string[]): Promise<RequestUserEntity> {
    const query = `
      UPDATE request_users
      SET reasons = $3
      WHERE request_media_id = $1 AND user_id = $2
      RETURNING *
    `;
    const { rows } = await this.pool.query<RequestUserRecord>(query, [mediaId, userId, reasons]);
    return fromRequestUserRecord(rows[0]);
  }

  async removeUserRequest(mediaId: string, userId: string): Promise<void> {
    const query = `
      DELETE FROM request_users
      WHERE request_media_id = $1 AND user_id = $2
    `;
    await this.pool.query(query, [mediaId, userId]);
  }

  async dropByUserAndKind(userId: string, kind: RequestKind, requests: RequestEntity[]): Promise<void> {
    for (const request of requests) {
      const reqUser = request.userRequests?.find((ru) => ru.userId === userId);
      if (reqUser) {
        reqUser.reasons = reqUser.reasons.filter((r) => r !== kind);
        // Keep due to other reasons
        if (reqUser.reasons.length) {
          await this.setUserRequestReasons(request.mediaId, userId, reqUser.reasons);
        } else {
          await this.removeUserRequest(request.mediaId, userId);
          // If no more users drop media_requests
          if (request.userRequests?.length === 1) {
            await this.removeRequest(request.mediaId);
          }
        }
      }
    }
  }

  async syncMediasForUserAndKind(user: UserEntity, kind: RequestKind, medias: MediaInfos[]): Promise<void> {
    const requests = await this.listByUserAndKind(user.id, kind);

    const newMedias = medias.filter((media) => !requests.some((request) => isSameMedia(request.media!, media)));
    const extraMedias = requests.filter((request) => !medias.some((media) => isSameMedia(request.media!, media)));

    RequestsRepository.logger.log(`Syncing user(${user.name}) requests for kind:${kind}`);
    RequestsRepository.logger.log(`Target requests: ${medias.length}`);
    RequestsRepository.logger.log(`Existing requests: ${requests.length}`);
    RequestsRepository.logger.log(`New: ${newMedias.length}, Extra: ${extraMedias.length}`);

    for (const media of newMedias) {
      await this.createUserRequest(media, user.id, kind);
    }

    await this.dropByUserAndKind(user.id, kind, extraMedias);
  }
}
