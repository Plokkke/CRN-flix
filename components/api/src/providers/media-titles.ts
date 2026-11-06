import { Provider } from '@nestjs/common';

import { MetadataSource } from '@crn-flix/contracts';
import { TmdbApiService, TmdbMetadataSource } from '@crn-flix/metadata-tmdb';

import { MediaFactsRepository } from '@/services/database/media-facts';
import { MediasRepository } from '@/services/database/medias';
import { IntegrationMonitor } from '@/services/integrations/monitor';
import { MediaFactsService } from '@/services/media-facts';
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
  {
    provide: MediaFactsService,
    inject: [METADATA, MediaFactsRepository, IntegrationMonitor],
    useFactory: (
      metadata: MetadataSource,
      stored: MediaFactsRepository,
      integrations: IntegrationMonitor,
    ): MediaFactsService => new MediaFactsService(metadata, stored, integrations),
  },
];
