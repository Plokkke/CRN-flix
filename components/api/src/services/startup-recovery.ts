import { Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleInit } from '@nestjs/common';
import { Pool } from 'pg';

import { concurrent } from '@/helpers/concurrent';
import { withDbRetry } from '@/helpers/db-retry';
import { SYNC_DATASOURCE } from '@/providers/syncDataSource';
import { DownloadJobsRepository } from '@/services/database/download-jobs';
import { PostDownloadPipeline } from '@/services/post-download-pipeline';

const STUCK_IDENTIFYING_MINUTES = 5;
const RECOVERY_CONCURRENCY = 3;

@Injectable()
export class StartupRecoveryService implements OnModuleInit, OnApplicationBootstrap {
  private static readonly logger = new Logger(StartupRecoveryService.name);

  constructor(
    @Inject(SYNC_DATASOURCE) private readonly pool: Pool,
    private readonly downloadJobs: DownloadJobsRepository,
    private readonly pipeline: PostDownloadPipeline,
  ) {}

  onModuleInit(): void {
    this.downloadJobs.setOnListenReconnect(() => this.drainPending());
  }

  async onApplicationBootstrap(): Promise<void> {
    await this.drainPending();
  }

  async drainPending(): Promise<void> {
    await this.resetStuckIdentifying();
    await this.processDetected();
  }

  private async resetStuckIdentifying(): Promise<void> {
    const result = await withDbRetry(
      () =>
        this.pool.query<{ id: string }>(
          `UPDATE download_jobs
             SET status = 'detected',
                 error_message = COALESCE(error_message, 'Reset on startup: previously stuck in identifying'),
                 updated_at = NOW()
           WHERE status = 'identifying'
             AND updated_at < NOW() - INTERVAL '${STUCK_IDENTIFYING_MINUTES} minutes'
           RETURNING id`,
        ),
      { label: 'recovery.resetStuck' },
    );
    for (const row of result.rows) {
      StartupRecoveryService.logger.warn(`Reset stuck job ${row.id} from identifying → detected`);
    }
  }

  private async processDetected(): Promise<void> {
    const result = await withDbRetry(
      () =>
        this.pool.query<{ id: string }>(
          `SELECT id FROM download_jobs WHERE status = 'detected' ORDER BY created_at ASC`,
        ),
      { label: 'recovery.drainDetected' },
    );
    if (result.rows.length === 0) {
      return;
    }

    StartupRecoveryService.logger.log(`Recovery: processing ${result.rows.length} detected job(s)`);
    await concurrent(result.rows, RECOVERY_CONCURRENCY, async (row) => {
      try {
        await this.pipeline.processJob(row.id);
      } catch (err) {
        StartupRecoveryService.logger.error(`Recovery processJob(${row.id}) failed: ${(err as Error).message}`);
      }
    });
  }
}
