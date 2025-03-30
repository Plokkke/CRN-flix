import { EventEmitter } from 'events';

import { Logger, OnModuleInit } from '@nestjs/common';
import { Pool, PoolClient } from 'pg';
import { z } from 'zod';

import { listen, transaction } from '@/helpers/sql';
import { JellyfinMedia } from '@/modules/jellyfin/jellyfin';

import { UserEntity } from './users';

export const MEDIA_TYPE = ['movie', 'episode'] as const;
export type MediaType = (typeof MEDIA_TYPE)[number];

export const REQUEST_STATUS = ['pending', 'in_progress', 'fulfilled', 'missing', 'rejected', 'canceled'] as const;
export type RequestStatus = (typeof REQUEST_STATUS)[number];

export type MediaRequestEntity = {
  id: string;
  createdAt: Date;
  updatedAt: Date;
  imdbId: string;
  status: RequestStatus;
  type: MediaType;
  title: string;
  year: number | null;
  seasonNumber: number | null;
  episodeNumber: number | null;
  userIds: string[];
  users?: UserEntity[];
  threadId: string | null;
};

export type MediaRequestInfos = Pick<
  MediaRequestEntity,
  'imdbId' | 'type' | 'title' | 'year' | 'seasonNumber' | 'episodeNumber' | 'userIds'
>;

type MediaRequestRecord = {
  id: string;
  imdb_id: string;
  status: RequestStatus;
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

const mediaRequestStatusChangedSchema = z
  .string()
  .transform((payload): unknown => JSON.parse(payload))
  .pipe(
    z.object({
      requestId: z.string(),
      oldStatus: z.string(),
      newStatus: z.string(),
    }),
  );

export type MediaRequestStatusChangedEvent = z.infer<typeof mediaRequestStatusChangedSchema>;

export class MediaRequestsRepository implements OnModuleInit {
  static readonly logger = new Logger(MediaRequestsRepository.name);
  private notificationClient?: PoolClient;

  private readonly eventEmitter = new EventEmitter();

  constructor(private readonly pool: Pool) {}

  async onModuleInit(): Promise<void> {
    this.notificationClient = await this.pool.connect();

    listen(
      this.notificationClient,
      'media_request_status_change',
      mediaRequestStatusChangedSchema,
      (event: MediaRequestStatusChangedEvent) => {
        this.eventEmitter.emit('statusChange', event);
      },
    );
  }

  onStatusChange(callback: (event: MediaRequestStatusChangedEvent) => void): () => void {
    this.eventEmitter.on('statusChange', callback);
    return () => this.eventEmitter.off('statusChange', callback);
  }

  async list(options?: { status?: RequestStatus }): Promise<MediaRequestEntity[]> {
    const query = `
      SELECT 
        ${COLUMNS.map((column) => `mr.${column}`).join(',')},
        ARRAY_AGG(mru.user_id) FILTER (WHERE mru.user_id IS NOT NULL) AS user_ids
      FROM 
        media_requests mr
      LEFT JOIN 
        media_requests_users mru ON mr.id = mru.media_request_id
      ${options?.status ? `WHERE mr.status = $1` : ''}
      GROUP BY 
        mr.id
    `;
    const { rows } = await this.pool.query<MediaRequestListRecord>(query, options?.status ? [options.status] : []);
    return rows.map(fromListRecord);
  }

  async get(id: string): Promise<MediaRequestEntity | null> {
    const query = `
      SELECT 
        ${COLUMNS.map((column) => `mr.${column}`).join(',')},
        ARRAY_AGG(mru.user_id) FILTER (WHERE mru.user_id IS NOT NULL) AS user_ids
      FROM
        media_requests mr
      LEFT JOIN
        media_requests_users mru ON mr.id = mru.media_request_id
      WHERE
        mr.id = $1
      GROUP BY
        mr.id
    `;
    const { rows } = await this.pool.query<MediaRequestListRecord>(query, [id]);
    return rows.length > 0 ? fromListRecord(rows[0]) : null;
  }

  async findByThreadId(threadId: string): Promise<MediaRequestEntity | null> {
    const query = `
      SELECT 
        ${COLUMNS.map((column) => `mr.${column}`).join(',')},
        ARRAY_AGG(mru.user_id) FILTER (WHERE mru.user_id IS NOT NULL) AS user_ids
      FROM 
        media_requests mr
      LEFT JOIN 
        media_requests_users mru ON mr.id = mru.media_request_id
      WHERE 
        mr.thread_id = $1
      GROUP BY 
        mr.id
    `;
    const { rows } = await this.pool.query<MediaRequestListRecord>(query, [threadId]);
    return rows.length > 0 ? fromListRecord(rows[0]) : null;
  }

  async updateStatus(requestId: string, status: RequestStatus): Promise<void> {
    const query = `UPDATE media_requests SET status = $2 WHERE id = $1`;
    await this.pool.query(query, [requestId, status]);
  }

  async attachThread(request: MediaRequestEntity, threadId: string): Promise<MediaRequestEntity> {
    const updateQuery = `UPDATE media_requests SET thread_id = $2 WHERE id = $1`;
    await this.pool.query(updateQuery, [request.id, threadId]);
    request.threadId = threadId;
    return request;
  }

  async syncTargeted(infosList: MediaRequestInfos[]): Promise<{
    inserted: MediaRequestEntity[];
    joinByUser: Record<string, MediaRequestEntity[]>;
  }> {
    const { requestByToken, infosByToken } = await this.prepareTargetedSets(infosList);
    const { toInsert, toCancel, toLink, toUnlink, joinByUser } = this.analyzeChanges(infosByToken, requestByToken);
    const { inserted } = await this.executeDbOperations(toInsert, toCancel, toLink, toUnlink, infosByToken, joinByUser);

    return {
      inserted,
      joinByUser,
    };
  }

  async syncCollected(infosList: JellyfinMedia[]): Promise<{
    fulfilled: MediaRequestEntity[];
  }> {
    const { requestByToken, infosByToken } = await this.prepareCollectedSets(infosList);
    const fulfilled = this.identifyFulfilledRequests(requestByToken, infosByToken);
    if (fulfilled.length) {
      await this.updateFulfilledRequests(fulfilled);
    }

    return { fulfilled: fulfilled.map((request) => ({ ...request, status: 'fulfilled' })) };
  }

  private async prepareTargetedSets(infosList: MediaRequestInfos[]): Promise<{
    infosByToken: Record<string, MediaRequestInfos>;
    requestByToken: Record<string, MediaRequestEntity>;
  }> {
    const requests = await this.list();

    const infosByToken = infosList.reduce(
      (acc, infos) => ({
        ...acc,
        [infos.imdbId]: infos,
      }),
      {} as Record<string, MediaRequestInfos>,
    );

    const requestByToken = requests.reduce(
      (acc, request) => ({
        ...acc,
        [request.imdbId]: request,
      }),
      {} as Record<string, MediaRequestEntity>,
    );

    return { infosByToken, requestByToken };
  }

  private async prepareCollectedSets(infosList: JellyfinMedia[]): Promise<{
    requestByToken: Record<string, MediaRequestEntity>;
    infosByToken: Record<string, JellyfinMedia>;
  }> {
    const requests = await this.list({ status: 'pending' });
    const requestByToken = requests.reduce(
      (acc, request) => ({
        ...acc,
        [request.imdbId]: request,
      }),
      {} as Record<string, MediaRequestEntity>,
    );

    const infosByToken = infosList.reduce(
      (acc, infos) => ({
        ...acc,
        [infos.ProviderIds.Imdb ?? '']: infos,
      }),
      {} as Record<string, JellyfinMedia>,
    );

    return { requestByToken, infosByToken };
  }

  // TODO to uncancel
  private analyzeChanges(
    infosByToken: Record<string, MediaRequestInfos>,
    requestByToken: Record<string, MediaRequestEntity>,
  ) {
    const toInsert: MediaRequestInfos[] = [];
    const toCancel: MediaRequestEntity[] = [];
    const toLink: [string, string][] = [];
    const toUnlink: [string, string][] = [];
    const joinByUser: Record<string, MediaRequestEntity[]> = {};

    const tokens = new Set<string>([...Object.keys(infosByToken), ...Object.keys(requestByToken)]);
    for (const token of tokens) {
      const infos = infosByToken[token];
      const request = requestByToken[token];

      if (infos && request) {
        if (request.status !== 'rejected') {
          this.attachRequester(infos, request, toLink, toUnlink, joinByUser);
        }
      } else if (!request) {
        toInsert.push(infos);
      } else if (!infos) {
        if (request.status === 'pending' || request.status === 'missing') {
          toCancel.push(request);
        }
      }
    }

    return { toInsert, toCancel, toLink, toUnlink, joinByUser };
  }

  private attachRequester(
    infos: MediaRequestInfos,
    request: MediaRequestEntity,
    toLink: [string, string][],
    toUnlink: [string, string][],
    joinByUser: Record<string, MediaRequestEntity[]>,
  ) {
    const userIds = new Set([...request.userIds, ...infos.userIds]);
    for (const userId of userIds) {
      if (!infos.userIds.includes(userId)) {
        toUnlink.push([request.id, userId]);
      }
      if (!request.userIds.includes(userId)) {
        toLink.push([request.id, userId]);
        (joinByUser[userId] || (joinByUser[userId] = [])).push(request);
      }
    }
  }

  private async executeDbOperations(
    toInsert: MediaRequestInfos[],
    toCancel: MediaRequestEntity[],
    toLink: [string, string][],
    toUnlink: [string, string][],
    infosByToken: Record<string, MediaRequestInfos>,
    joinByUser: Record<string, MediaRequestEntity[]>,
  ): Promise<{
    inserted: MediaRequestEntity[];
  }> {
    let inserted: MediaRequestEntity[] = [];

    await transaction(this.pool, async (client: PoolClient) => {
      if (toInsert.length > 0) {
        inserted = await this.insertNewRequests(client, toInsert, infosByToken, toLink, joinByUser);
      }
      if (toCancel.length > 0) {
        await this.cancelRequests(client, toCancel);
      }
      if (toLink.length > 0) {
        await this.linkUsers(client, toLink);
      }
      if (toUnlink.length > 0) {
        await this.unlinkUsers(client, toUnlink);
      }
    });

    return {
      inserted,
    };
  }

  private async insertNewRequests(
    client: PoolClient,
    toInsert: MediaRequestInfos[],
    infosByToken: Record<string, MediaRequestInfos>,
    toLink: [string, string][],
    joinByUser: Record<string, MediaRequestEntity[]>,
  ): Promise<MediaRequestEntity[]> {
    const columns = ['imdb_id', 'status', 'type', 'title', 'year', 'season_number', 'episode_number'];
    const insertQuery = `INSERT INTO media_requests (${columns.join(',')})
    VALUES ${toInsert.map((val, entryIdx) => `(${columns.map((col, colIdx) => `$${entryIdx * columns.length + colIdx + 1}`).join(',')})`).join(',')}
    RETURNING id, imdb_id, season_number, episode_number`;

    const { rows: insertedRows } = await client.query<MediaRequestRecord>(
      insertQuery,
      toInsert.flatMap((infos) => [
        infos.imdbId,
        'pending',
        infos.type,
        infos.title,
        infos.year,
        infos.seasonNumber,
        infos.episodeNumber,
      ]),
    );

    return this.processInsertedRows(insertedRows, infosByToken, toLink, joinByUser);
  }

  private processInsertedRows(
    insertedRows: MediaRequestRecord[],
    infosByToken: Record<string, MediaRequestInfos>,
    toLink: [string, string][],
    joinByUser: Record<string, MediaRequestEntity[]>,
  ): MediaRequestEntity[] {
    return insertedRows.map((insertedRow) => {
      const infos = infosByToken[insertedRow.imdb_id];

      const entity: MediaRequestEntity = {
        ...infos,
        id: insertedRow.id,
        createdAt: insertedRow.created_at,
        updatedAt: insertedRow.updated_at,
        status: 'pending',
        threadId: null,
      };

      infos.userIds.forEach((userId) => {
        toLink.push([insertedRow.id, userId]);
        (joinByUser[userId] || (joinByUser[userId] = [])).push(entity);
      });

      return entity;
    });
  }

  private async cancelRequests(client: PoolClient, toCancel: MediaRequestEntity[]) {
    const cancelQuery = `UPDATE media_requests SET status = 'canceled' WHERE id = ANY($1)`;
    await client.query(cancelQuery, [toCancel.map((request) => request.id)]);
  }

  private async linkUsers(client: PoolClient, toLink: [string, string][]) {
    const linkQuery = `
    INSERT INTO media_requests_users (media_request_id, user_id)
    SELECT * FROM UNNEST($1::uuid[], $2::uuid[])
  `;
    await client.query(linkQuery, [toLink.map((pair) => pair[0]), toLink.map((pair) => pair[1])]);
  }

  private async unlinkUsers(client: PoolClient, toUnlink: [string, string][]) {
    const unlinkQuery = `DELETE FROM media_requests_users
    WHERE (media_request_id, user_id) IN (${toUnlink.map((_, entryIdx) => `($${entryIdx * 2 + 1}, $${entryIdx * 2 + 2})`).join(',')})`;
    await client.query(unlinkQuery, toUnlink.flat());
  }

  private identifyFulfilledRequests(
    requestByToken: Record<string, MediaRequestEntity>,
    infosByToken: Record<string, JellyfinMedia>,
  ): MediaRequestEntity[] {
    const fulfilled: MediaRequestEntity[] = [];

    const tokens = new Set<string>([...Object.keys(infosByToken), ...Object.keys(requestByToken)]);
    for (const token of tokens) {
      const infos = infosByToken[token];
      const request = requestByToken[token];

      if (infos && request) {
        fulfilled.push(request);
      }
    }

    return fulfilled;
  }

  private async updateFulfilledRequests(fulfilled: MediaRequestEntity[]): Promise<void> {
    await transaction(this.pool, async (client: PoolClient) => {
      const updateQuery = `UPDATE media_requests SET status = 'fulfilled' WHERE id = ANY($1)`;
      await client.query(updateQuery, [fulfilled.map((request) => request.id)]);
    });
  }
}
