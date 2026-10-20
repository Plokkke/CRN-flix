import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';

import { AdminChannel, Downloader, Unsubscribe } from '@crn-flix/contracts';

import { DOWNLOADER } from '@/providers/downloader';
import { ADMIN_CHANNEL } from '@/providers/messaging/admin';
import { buildDownloadsBoardView } from '@/services/download-format';

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
    @Inject(ADMIN_CHANNEL) private readonly adminChannel: AdminChannel,
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
      await this.adminChannel.showDownloads(buildDownloadsBoardView(this.downloader.liveDownloads()));
    } catch (error) {
      DownloadProgressService.logger.error(
        `Failed to publish download progress: ${error instanceof Error ? error.message : error}`,
      );
    }
  }
}
