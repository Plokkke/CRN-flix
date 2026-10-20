import { Provider } from '@nestjs/common';

import { MediaTitlesResolver, TmdbApiService } from '@crn-flix/metadata-tmdb';

import { MediasRepository } from '@/services/database/medias';
import { MediaTitlesService } from '@/services/media-titles';

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
