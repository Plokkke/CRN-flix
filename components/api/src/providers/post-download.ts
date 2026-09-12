import { Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';

import { Config } from '@/app.module';
import { TmdbApiService } from '@/modules/tmdb/tmdb';
import { SYNC_DATASOURCE } from '@/providers/syncDataSource';
import { DownloadJobsRepository } from '@/services/database/download-jobs';
import { MediasRepository } from '@/services/database/medias';
import { RequestsRepository } from '@/services/database/requests';
import { TicketsRepository } from '@/services/database/tickets';
import { EnglishTitleResolver } from '@/services/english-title-resolver';
import { MediaIdentifierService } from '@/services/media-identifier';
import { MediaLabelizerService } from '@/services/media-labelizer';
import { PostDownloadPipeline } from '@/services/post-download-pipeline';

export const identificationProvider: Provider = {
  provide: MediaIdentifierService,
  inject: [TmdbApiService, SYNC_DATASOURCE, MediasRepository, RequestsRepository],
  useFactory: (
    tmdb: TmdbApiService,
    pool: Pool,
    medias: MediasRepository,
    requests: RequestsRepository,
  ): MediaIdentifierService => new MediaIdentifierService(tmdb, pool, medias, requests),
};

export const englishTitleResolverProvider: Provider = {
  provide: EnglishTitleResolver,
  inject: [TmdbApiService],
  useFactory: (tmdb: TmdbApiService): EnglishTitleResolver => new EnglishTitleResolver(tmdb),
};

export const placementProvider: Provider = {
  provide: MediaLabelizerService,
  inject: [ConfigService, EnglishTitleResolver],
  useFactory: (
    configService: ConfigService<Config, true>,
    englishTitle: EnglishTitleResolver,
  ): MediaLabelizerService => {
    const config = configService.get('mediaPaths');
    return new MediaLabelizerService(config, englishTitle);
  },
};

export const postDownloadPipelineProvider: Provider = {
  provide: PostDownloadPipeline,
  inject: [DownloadJobsRepository, MediaIdentifierService, MediaLabelizerService, TicketsRepository],
  useFactory: (
    downloadJobs: DownloadJobsRepository,
    identification: MediaIdentifierService,
    placement: MediaLabelizerService,
    tickets: TicketsRepository,
  ): PostDownloadPipeline => new PostDownloadPipeline(downloadJobs, identification, placement, tickets),
};

export const postDownloadProviders: Provider[] = [
  englishTitleResolverProvider,
  identificationProvider,
  placementProvider,
  postDownloadPipelineProvider,
];
