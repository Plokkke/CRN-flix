import { Provider } from '@nestjs/common';

import { MetadataSource } from '@crn-flix/contracts';
import { TmdbApiService, TmdbMetadataSource } from '@crn-flix/metadata-tmdb';

import { MediasRepository } from '@/services/database/medias';
import { MediaTitlesService } from '@/services/media-titles';

export const METADATA = Symbol('MetadataSource');

export const mediaTitlesProviders: Provider[] = [
  {
    provide: METADATA,
    inject: [TmdbApiService],
    useFactory: (tmdb: TmdbApiService): MetadataSource => new TmdbMetadataSource(tmdb),
  },
  {
    provide: MediaTitlesService,
    inject: [METADATA, MediasRepository],
    useFactory: (metadata: MetadataSource, medias: MediasRepository): MediaTitlesService =>
      new MediaTitlesService(metadata, medias),
  },
];
