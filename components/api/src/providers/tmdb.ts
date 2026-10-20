import { Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { TmdbApiService } from '@crn-flix/metadata-tmdb';

import { Config } from '@/app.module';

export const tmdbProvider: Provider = {
  provide: TmdbApiService,
  inject: [ConfigService],
  useFactory: (configService: ConfigService<Config, true>): TmdbApiService => {
    const config = configService.get('tmdb');
    return new TmdbApiService(config);
  },
};
