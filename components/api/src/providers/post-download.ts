import { Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';

import { Config } from '@/app.module';
import { TmdbApiService } from '@/modules/tmdb/tmdb';
import { SYNC_DATASOURCE } from '@/providers/syncDataSource';
import { DownloadJobsRepository } from '@/services/database/download-jobs';
import { MediasRepository } from '@/services/database/medias';
import { RequestsRepository } from '@/services/database/requests';
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

export const placementProvider: Provider = {
  provide: MediaLabelizerService,
  inject: [ConfigService],
  useFactory: (configService: ConfigService<Config, true>): MediaLabelizerService => {
    const config = configService.get('mediaPaths');
    return new MediaLabelizerService(config);
  },
};

export const postDownloadPipelineProvider: Provider = {
  provide: PostDownloadPipeline,
  inject: [DownloadJobsRepository, MediaIdentifierService, MediaLabelizerService],
  useFactory: (
    downloadJobs: DownloadJobsRepository,
    identification: MediaIdentifierService,
    placement: MediaLabelizerService,
  ): PostDownloadPipeline => new PostDownloadPipeline(downloadJobs, identification, placement),
};

export const postDownloadProviders: Provider[] = [
  identificationProvider,
  placementProvider,
  postDownloadPipelineProvider,
];
