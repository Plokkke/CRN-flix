import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';
import { z } from 'zod';

import { Config } from '@/app.module';

import { postgresConfigSchema, postgresFactory } from './factories/porstgres';

export const SYNC_DATASOURCE = 'SYNC_DATASOURCE';

export const syncDataSourceConfigSchema = postgresConfigSchema;

export type SyncDatasourceConfig = z.infer<typeof syncDataSourceConfigSchema>;

export const syncDataSourceProvider = {
  provide: SYNC_DATASOURCE,
  inject: [ConfigService],
  useFactory: async (configService: ConfigService<Config, true>): Promise<Pool> => {
    const config = configService.get<Config['sync-datasource']>('sync-datasource');
    const pool = await postgresFactory(config);

    return pool;
  },
};
