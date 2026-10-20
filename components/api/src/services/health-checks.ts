import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { HealthRegistryService } from '@plokkke/nest-health-registry';
import { Pool } from 'pg';

import { AdminChannel, Downloader } from '@crn-flix/contracts';

import { DOWNLOADER } from '@/providers/downloader';
import { ADMIN_CHANNEL } from '@/providers/messaging/admin';
import { SYNC_DATASOURCE } from '@/providers/syncDataSource';
import { AllUserMessaging } from '@/services/messaging/user/all';

const POOL_PROBE_TIMEOUT_MS = 2000;

@Injectable()
export class HealthChecksService implements OnModuleInit {
  private static readonly logger = new Logger(HealthChecksService.name);

  constructor(
    @Inject(SYNC_DATASOURCE) private readonly pool: Pool,
    @Inject(DOWNLOADER) private readonly downloader: Downloader,
    private readonly registry: HealthRegistryService,
    private readonly messaging: AllUserMessaging,
    @Inject(ADMIN_CHANNEL) private readonly adminChannel: AdminChannel,
  ) {}

  onModuleInit(): void {
    // The downloader is optional at runtime (auto-reconnect): its absence must not mark the engine unready.
    this.registry.addReadinessCheck('postgres', () => this.checkPostgres());
    // Without a user channel nobody can register, log in or be notified: unready, so the platform alerts.
    this.registry.addReadinessCheck('user-messaging', () => this.messaging.canReachUsers);
    // Without it admins can neither act on tickets nor log in to the dashboard (the OTP codes go through it).
    this.registry.addReadinessCheck('admin-channel', () => this.adminChannel.isConnected());
    this.registry.addLivenessCheck('process', () => true);
    this.registry.addLivenessCheck('downloader', () => this.reportDownloader());
  }

  private reportDownloader(): boolean {
    if (!this.downloader.isConnected()) {
      HealthChecksService.logger.debug(
        `${this.downloader.name} downloader not connected (engine keeps running, reconnect pending)`,
      );
    }
    return true;
  }

  private async checkPostgres(): Promise<boolean> {
    try {
      const client = await Promise.race([
        this.pool.connect(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('connect timeout')), POOL_PROBE_TIMEOUT_MS),
        ),
      ]);
      try {
        await client.query('SELECT 1');
        return true;
      } finally {
        client.release();
      }
    } catch (err) {
      HealthChecksService.logger.warn(`Postgres readiness check failed: ${(err as Error).message}`);
      return false;
    }
  }
}
