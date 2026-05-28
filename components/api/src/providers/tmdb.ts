import { Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { Config } from '@/app.module';
import { TmdbApiService } from '@/modules/tmdb/tmdb';

export const tmdbProvider: Provider = {
  provide: TmdbApiService,
  inject: [ConfigService],
  useFactory: (configService: ConfigService<Config, true>): TmdbApiService => {
    const config = configService.get('tmdb');
    return new TmdbApiService(config);
  },
};
