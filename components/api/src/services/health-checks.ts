import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { HealthRegistryService } from '@plokkke/nest-health-registry';
import { Pool } from 'pg';

import { SYNC_DATASOURCE } from '@/providers/syncDataSource';
import { FetchrSyncService } from '@/services/fetchr-sync';

const POOL_PROBE_TIMEOUT_MS = 2000;

@Injectable()
export class HealthChecksService implements OnModuleInit {
  private static readonly logger = new Logger(HealthChecksService.name);

  constructor(
    @Inject(SYNC_DATASOURCE) private readonly pool: Pool,
    private readonly fetchrSync: FetchrSyncService,
    private readonly registry: HealthRegistryService,
  ) {}

  onModuleInit(): void {
    this.registry.addReadinessCheck('postgres', () => this.checkPostgres());
    this.registry.addReadinessCheck('fetchr-ws', () => this.fetchrSync.isConnected());
    this.registry.addLivenessCheck('process', () => true);
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
