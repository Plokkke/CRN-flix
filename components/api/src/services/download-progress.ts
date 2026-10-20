import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';

import { Downloader, Unsubscribe } from '@crn-flix/contracts';

import { DOWNLOADER } from '@/providers/downloader';
import { DownloadsBoard } from '@/services/messaging/admin/downloads-board';

/**
 * Discord rate-limits message edits, and a download runs for minutes: a fixed tick is both
 * cheaper and steadier than debouncing the progress firehose.
 */
const REFRESH_INTERVAL_MS = 30_000;

@Injectable()
export class DownloadProgressService implements OnModuleInit, OnModuleDestroy {
  private static readonly logger = new Logger(DownloadProgressService.name);

  private unsubscribe: Unsubscribe | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private dirty = false;

  constructor(
    @Inject(DOWNLOADER) private readonly downloader: Downloader,
    private readonly downloadsBoard: DownloadsBoard,
  ) {}

  onModuleInit(): void {
    this.unsubscribe = this.downloader.onLiveChanged(() => {
      this.dirty = true;
    });
    this.timer = setInterval(() => void this.flush(), REFRESH_INTERVAL_MS);
  }

  onModuleDestroy(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async flush(): Promise<void> {
    if (!this.dirty) {
      return;
    }
    this.dirty = false;

    try {
      await this.downloadsBoard.refresh(this.downloader.liveDownloads());
    } catch (error) {
      DownloadProgressService.logger.error(
        `Failed to publish download progress: ${error instanceof Error ? error.message : error}`,
      );
    }
  }
}
