import { ConfigService } from '@nestjs/config';

import { Config } from '@/app.module';
import { TraktApi } from '@/modules/trakt/TraktApi';
import { SyncService } from '@/services/sync';

export const syncProvider = {
  provide: SyncService,
  useFactory: (traktApi: TraktApi, configService: ConfigService<Config, true>): SyncService => {
    return new SyncService(traktApi, configService.get('sync'));
  },
  inject: [TraktApi, ConfigService],
};
