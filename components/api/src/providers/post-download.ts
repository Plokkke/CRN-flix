import { Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';

import { MetadataSource } from '@crn-flix/contracts';
import { JellyfinLayout } from '@crn-flix/layout-jellyfin';
import { TmdbApiService } from '@crn-flix/metadata-tmdb';

import { Config } from '@/app.module';
import { METADATA } from '@/providers/media-titles';
import { SYNC_DATASOURCE } from '@/providers/syncDataSource';
import { DownloadJobsRepository } from '@/services/database/download-jobs';
import { MediasRepository } from '@/services/database/medias';
import { RequestsRepository } from '@/services/database/requests';
import { TicketsRepository } from '@/services/database/tickets';
import { MediaIdentifierService } from '@/services/media-identifier';
import { MediaLabelizerService } from '@/services/media-labelizer';
import { PostDownloadPipeline } from '@/services/post-download-pipeline';

export const identificationProvider: Provider = {
  provide: MediaIdentifierService,
  inject: [TmdbApiService, SYNC_DATASOURCE, MediasRepository, RequestsRepository, METADATA],
  useFactory: (
    tmdb: TmdbApiService,
    pool: Pool,
    medias: MediasRepository,
    requests: RequestsRepository,
    titles: MetadataSource,
  ): MediaIdentifierService => new MediaIdentifierService(tmdb, pool, medias, requests, titles),
};

export const placementProvider: Provider = {
  provide: MediaLabelizerService,
  inject: [ConfigService, METADATA],
  useFactory: (configService: ConfigService<Config, true>, titles: MetadataSource): MediaLabelizerService =>
    new MediaLabelizerService(configService.get('mediaPaths'), titles, new JellyfinLayout()),
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
