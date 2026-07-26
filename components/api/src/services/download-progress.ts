import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';

import { Listener } from '@/helpers/events';
import { FetchrSyncEvents, FetchrSyncService } from '@/services/fetchr-sync';
import { DiscordAdminMessaging } from '@/services/messaging/admin/discord';

/**
 * Discord rate-limits message edits, and a download runs for minutes: a fixed tick is both
 * cheaper and steadier than debouncing the progress firehose.
 */
const REFRESH_INTERVAL_MS = 30_000;

@Injectable()
export class DownloadProgressService implements OnModuleInit, OnModuleDestroy {
  private static readonly logger = new Logger(DownloadProgressService.name);

  private listener: Listener<FetchrSyncEvents> | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private dirty = false;

  constructor(
    private readonly fetchrSync: FetchrSyncService,
    private readonly adminsMessaging: DiscordAdminMessaging,
  ) {}

  onModuleInit(): void {
    this.listener = this.fetchrSync.listen({
      liveChanged: () => {
        this.dirty = true;
      },
    });
    this.timer = setInterval(() => void this.flush(), REFRESH_INTERVAL_MS);
  }

  onModuleDestroy(): void {
    this.listener?.cleanup();
    this.listener = null;
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
      await this.adminsMessaging.refreshDownloadsMessage(this.fetchrSync.liveDownloads());
    } catch (error) {
      DownloadProgressService.logger.error(
        `Failed to publish download progress: ${error instanceof Error ? error.message : error}`,
      );
    }
  }
}
