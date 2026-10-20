import { ConfigService } from '@nestjs/config';

import { TraktApi } from '@crn-flix/catalog-trakt';

import { Config } from '@/app.module';
import { MemoryCacheService } from '@/services/cache/memory-cache.service';

export const traktProvider = {
  provide: TraktApi,
  inject: [ConfigService, MemoryCacheService],
  useFactory: (configService: ConfigService<Config, true>, cache: MemoryCacheService): TraktApi => {
    return new TraktApi(configService.get('trakt'), cache);
  },
};
