import { Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Pool } from 'pg';
import { z } from 'zod';

import { withDbRetry } from '@/helpers/db-retry';
import { Emitter } from '@/helpers/events';
import { ListenChannel, ListenHandle, listenWithReconnect } from '@/helpers/sql';

export enum DownloadJobStatus {
  Detected = 'detected',
  Identifying = 'identifying',
  Completed = 'completed',
  Failed = 'failed',
}

export type DownloadJobEntity = {
  id: string;
  sourceId: string;
  packageName: string;
  saveTo: string;
  status: DownloadJobStatus;
  sourcePaths: string[];
  errorMessage: string | null;
  discordMessageId: string | null;
  metadata: Record<string, string> | null;
  createdAt: Date;
  updatedAt: Date;
};

type DownloadJobRecord = {
  id: string;
  source_id: string;
  package_name: string;
  save_to: string;
  status: string;
  source_paths: string[];
  error_message: string | null;
  discord_message_id: string | null;
  metadata: Record<string, string> | null;
  created_at: Date;
  updated_at: Date;
};

function mapRecord(record: DownloadJobRecord): DownloadJobEntity {
  return {
    id: record.id,
    sourceId: record.source_id,
    packageName: record.package_name,
    saveTo: record.save_to,
    status: record.status as DownloadJobStatus,
    sourcePaths: record.source_paths,
    errorMessage: record.error_message,
    discordMessageId: record.discord_message_id,
    metadata: record.metadata,
    createdAt: record.created_at,
    updatedAt: record.updated_at,
  };
}

const stringParseMorphing = z.string().transform((payload): unknown => JSON.parse(payload));

const downloadJobCreatedEventSchema = z.object({
  jobId: z.string(),
});
export type DownloadJobCreatedEvent = z.infer<typeof downloadJobCreatedEventSchema>;
const downloadJobCreatedEventMorphing = stringParseMorphing.pipe(downloadJobCreatedEventSchema);

const downloadJobStatusChangedEventSchema = z.object({
  jobId: z.string(),
  oldStatus: z.string(),
  newStatus: z.string(),
});
export type DownloadJobStatusChangedEvent = z.infer<typeof downloadJobStatusChangedEventSchema>;
const downloadJobStatusChangedEventMorphing = stringParseMorphing.pipe(downloadJobStatusChangedEventSchema);

export type DownloadJobEvents = {
  created: DownloadJobCreatedEvent;
  statusChange: DownloadJobStatusChangedEvent;
};

export class DownloadJobsRepository extends Emitter<DownloadJobEvents> implements OnModuleInit, OnModuleDestroy {
  private static readonly logger = new Logger(DownloadJobsRepository.name);

  private listenHandle: ListenHandle | null = null;
  private onListenReconnect: (() => Promise<void>) | null = null;

  constructor(private readonly pool: Pool) {
    super();
  }

  /** Wire a callback that runs after the LISTEN client reconnects (e.g. to replay missed events). */
  setOnListenReconnect(cb: () => Promise<void>): void {
    this.onListenReconnect = cb;
  }

  onModuleInit(): void {
    const channels: ListenChannel[] = [
      {
        channel: 'download_job_created',
        schema: downloadJobCreatedEventMorphing,
        callback: (msg) => {
          DownloadJobsRepository.logger.debug(`Received "created": ${JSON.stringify(msg)}`);
          this.emit('created', msg as DownloadJobCreatedEvent);
        },
      },
      {
        channel: 'download_job_status_changed',
        schema: downloadJobStatusChangedEventMorphing,
        callback: (msg) => {
          DownloadJobsRepository.logger.debug(`Received "statusChange": ${JSON.stringify(msg)}`);
          this.emit('statusChange', msg as DownloadJobStatusChangedEvent);
        },
      },
    ];
    this.listenHandle = listenWithReconnect(
      this.pool,
      channels,
      async () => {
        if (this.onListenReconnect) {
          await this.onListenReconnect();
        }
      },
      'DownloadJobsRepository',
    );
  }

  async onModuleDestroy(): Promise<void> {
    if (this.listenHandle) {
      await this.listenHandle.close();
      this.listenHandle = null;
    }
  }

  async create(data: {
    sourceId: string;
    packageName: string;
    saveTo: string;
    sourcePaths?: string[];
    metadata?: Record<string, string>;
  }): Promise<DownloadJobEntity | null> {
    const result = await withDbRetry(
      () =>
        this.pool.query<DownloadJobRecord>(
          `INSERT INTO download_jobs (source_id, package_name, save_to, source_paths, status, metadata)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (source_id) DO NOTHING
           RETURNING *`,
          [
            data.sourceId,
            data.packageName,
            data.saveTo,
            data.sourcePaths ?? [],
            DownloadJobStatus.Detected,
            data.metadata ? JSON.stringify(data.metadata) : null,
          ],
        ),
      { label: 'downloadJobs.create' },
    );
    if (result.rows.length === 0) {
      return null;
    }
    return mapRecord(result.rows[0]);
  }

  async updateSourcePaths(id: string, sourcePaths: string[]): Promise<void> {
    await withDbRetry(
      () =>
        this.pool.query(`UPDATE download_jobs SET source_paths = $2, updated_at = NOW() WHERE id = $1`, [
          id,
          sourcePaths,
        ]),
      { label: 'downloadJobs.updateSourcePaths' },
    );
  }

  async updateStatus(id: string, status: DownloadJobStatus, errorMessage?: string): Promise<void> {
    await withDbRetry(
      () =>
        this.pool.query(`UPDATE download_jobs SET status = $2, error_message = $3, updated_at = NOW() WHERE id = $1`, [
          id,
          status,
          errorMessage ?? null,
        ]),
      { label: 'downloadJobs.updateStatus' },
    );
  }

  async get(id: string): Promise<DownloadJobEntity | null> {
    const result = await withDbRetry(
      () => this.pool.query<DownloadJobRecord>('SELECT * FROM download_jobs WHERE id = $1', [id]),
      { label: 'downloadJobs.get' },
    );
    return result.rows[0] ? mapRecord(result.rows[0]) : null;
  }

  async getBySourceId(sourceId: string): Promise<DownloadJobEntity | null> {
    const result = await withDbRetry(
      () => this.pool.query<DownloadJobRecord>('SELECT * FROM download_jobs WHERE source_id = $1', [sourceId]),
      { label: 'downloadJobs.getBySourceId' },
    );
    return result.rows[0] ? mapRecord(result.rows[0]) : null;
  }

  async updateDiscordMessageId(id: string, messageId: string): Promise<void> {
    await withDbRetry(
      () =>
        this.pool.query(`UPDATE download_jobs SET discord_message_id = $2, updated_at = NOW() WHERE id = $1`, [
          id,
          messageId,
        ]),
      { label: 'downloadJobs.updateDiscordMessageId' },
    );
  }

  async getByDiscordMessageId(messageId: string): Promise<DownloadJobEntity | null> {
    const result = await withDbRetry(
      () =>
        this.pool.query<DownloadJobRecord>('SELECT * FROM download_jobs WHERE discord_message_id = $1', [messageId]),
      { label: 'downloadJobs.getByDiscordMessageId' },
    );
    return result.rows[0] ? mapRecord(result.rows[0]) : null;
  }
}
