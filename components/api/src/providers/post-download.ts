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
import { MediaIdentifierService } from '@/services/media-identifier';
import { MediaLabelizerService } from '@/services/media-labelizer';
import { MediaTitlesResolver } from '@/services/media-titles-resolver';
import { PostDownloadPipeline } from '@/services/post-download-pipeline';

export const identificationProvider: Provider = {
  provide: MediaIdentifierService,
  inject: [TmdbApiService, SYNC_DATASOURCE, MediasRepository, RequestsRepository, MediaTitlesResolver],
  useFactory: (
    tmdb: TmdbApiService,
    pool: Pool,
    medias: MediasRepository,
    requests: RequestsRepository,
    titles: MediaTitlesResolver,
  ): MediaIdentifierService => new MediaIdentifierService(tmdb, pool, medias, requests, titles),
};

export const placementProvider: Provider = {
  provide: MediaLabelizerService,
  inject: [ConfigService, MediaTitlesResolver],
  useFactory: (configService: ConfigService<Config, true>, titles: MediaTitlesResolver): MediaLabelizerService => {
    const config = configService.get('mediaPaths');
    return new MediaLabelizerService(config, titles);
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
  identificationProvider,
  placementProvider,
  postDownloadPipelineProvider,
];
