import { Provider } from '@nestjs/common';

import { TmdbApiService } from '@/modules/tmdb/tmdb';
import { MediasRepository } from '@/services/database/medias';
import { MediaTitlesService } from '@/services/media-titles';
import { MediaTitlesResolver } from '@/services/media-titles-resolver';

export const mediaTitlesProviders: Provider[] = [
  {
    provide: MediaTitlesResolver,
    inject: [TmdbApiService],
    useFactory: (tmdb: TmdbApiService): MediaTitlesResolver => new MediaTitlesResolver(tmdb),
  },
  {
    provide: MediaTitlesService,
    inject: [MediaTitlesResolver, MediasRepository],
    useFactory: (resolver: MediaTitlesResolver, medias: MediasRepository): MediaTitlesService =>
      new MediaTitlesService(resolver, medias),
  },
];
