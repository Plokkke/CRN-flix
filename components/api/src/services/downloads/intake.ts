import * as path from 'path';

import { Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';

import { CompletedDownload, Downloader, Unsubscribe } from '@crn-flix/contracts';

import { withDbRetry } from '@/helpers/db-retry';
import { DownloadJobsRepository } from '@/services/database/download-jobs';

/**
 * Runs the downloader for the engine's lifetime and turns each completion into a
 * `download_jobs` row, which starts the post-download pipeline. Completions can be
 * replayed by the downloader: a known source id is skipped.
 */
export class DownloadIntakeService implements OnModuleInit, OnModuleDestroy {
  private static readonly logger = new Logger(DownloadIntakeService.name);

  private unsubscribe: Unsubscribe | null = null;

  constructor(
    private readonly downloader: Downloader,
    private readonly downloadJobs: DownloadJobsRepository,
  ) {}

  onModuleInit(): void {
    this.unsubscribe = this.downloader.onCompleted((download) => this.record(download));
    this.downloader.start();
  }

  onModuleDestroy(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.downloader.stop();
  }

  async record(download: CompletedDownload): Promise<void> {
    if (await this.downloadJobs.getBySourceId(download.id).catch(() => null)) {
      return;
    }
    try {
      await withDbRetry(
        () =>
          this.downloadJobs.create({
            sourceId: download.id,
            packageName: download.fileName,
            saveTo: download.filePaths.length > 0 ? path.dirname(download.filePaths[0]) : '',
            sourcePaths: download.filePaths,
            metadata: download.metadata,
          }),
        { label: 'downloadIntake.create', attempts: 6, baseMs: 500, maxMs: 8000 },
      );
    } catch (err) {
      DownloadIntakeService.logger.error(
        `Failed to persist completed download ${download.id} (${download.fileName}) after retries: ${(err as Error).message}. The ${this.downloader.name} downloader will replay it on next reconnect.`,
      );
    }
  }
}
