import { ConfigService } from '@nestjs/config';

import { Config } from '@/app.module';
import { TraktApi } from '@/modules/trakt/TraktApi';

export const traktProvider = {
  provide: TraktApi,
  useFactory: (configService: ConfigService<Config, true>): TraktApi => {
    return new TraktApi(configService.get('trakt'));
  },
  inject: [ConfigService],
};
