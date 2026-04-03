import { Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Pool, PoolClient } from 'pg';
import { z } from 'zod';

import { Emitter } from '@/helpers/events';
import { listen } from '@/helpers/sql';

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
  discordErrorMessageId: string | null;
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
  discord_error_message_id: string | null;
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
    discordErrorMessageId: record.discord_error_message_id,
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

const LISTENING_MAP: {
  channel: string;
  schema: z.ZodType<DownloadJobEvents[keyof DownloadJobEvents]>;
  event: keyof DownloadJobEvents;
}[] = [
  {
    channel: 'download_job_created',
    schema: downloadJobCreatedEventMorphing,
    event: 'created',
  },
  {
    channel: 'download_job_status_changed',
    schema: downloadJobStatusChangedEventMorphing,
    event: 'statusChange',
  },
];

export class DownloadJobsRepository extends Emitter<DownloadJobEvents> implements OnModuleInit, OnModuleDestroy {
  private static readonly logger = new Logger(DownloadJobsRepository.name);

  private listenClient: PoolClient | null = null;

  constructor(private readonly pool: Pool) {
    super();
  }

  async onModuleInit(): Promise<void> {
    this.listenClient = await this.pool.connect();

    for (const { channel, schema, event } of LISTENING_MAP) {
      DownloadJobsRepository.logger.log(`Subscribing to PostgreSQL channel: ${channel}`);
      listen(this.listenClient, channel, schema, (msg: z.infer<typeof schema>) => {
        DownloadJobsRepository.logger.debug(`Received event "${String(event)}": ${JSON.stringify(msg)}`);
        this.emit(event, msg);
      });
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.listenClient) {
      this.listenClient.release();
      this.listenClient = null;
    }
  }

  async create(data: {
    sourceId: string;
    packageName: string;
    saveTo: string;
    sourcePaths?: string[];
  }): Promise<DownloadJobEntity | null> {
    const result = await this.pool.query<DownloadJobRecord>(
      `INSERT INTO download_jobs (source_id, package_name, save_to, source_paths, status)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (source_id) DO NOTHING
       RETURNING *`,
      [data.sourceId, data.packageName, data.saveTo, data.sourcePaths ?? [], DownloadJobStatus.Detected],
    );
    if (result.rows.length === 0) {
      return null;
    }
    return mapRecord(result.rows[0]);
  }

  async updateSourcePaths(id: string, sourcePaths: string[]): Promise<void> {
    await this.pool.query(`UPDATE download_jobs SET source_paths = $2, updated_at = NOW() WHERE id = $1`, [
      id,
      sourcePaths,
    ]);
  }

  async updateStatus(id: string, status: DownloadJobStatus, errorMessage?: string): Promise<void> {
    await this.pool.query(
      `UPDATE download_jobs SET status = $2, error_message = $3, updated_at = NOW() WHERE id = $1`,
      [id, status, errorMessage ?? null],
    );
  }

  async get(id: string): Promise<DownloadJobEntity | null> {
    const result = await this.pool.query<DownloadJobRecord>('SELECT * FROM download_jobs WHERE id = $1', [id]);
    return result.rows[0] ? mapRecord(result.rows[0]) : null;
  }

  async updateDiscordErrorMessageId(id: string, messageId: string): Promise<void> {
    await this.pool.query(`UPDATE download_jobs SET discord_error_message_id = $2, updated_at = NOW() WHERE id = $1`, [
      id,
      messageId,
    ]);
  }

  async getByDiscordErrorMessageId(messageId: string): Promise<DownloadJobEntity | null> {
    const result = await this.pool.query<DownloadJobRecord>(
      'SELECT * FROM download_jobs WHERE discord_error_message_id = $1',
      [messageId],
    );
    return result.rows[0] ? mapRecord(result.rows[0]) : null;
  }
}
