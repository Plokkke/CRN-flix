import { Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';

import { Config } from '@/app.module';
import { JDownloaderApiService } from '@/modules/jdownloader/jdownloader-api.service';
import { TmdbApiService } from '@/modules/tmdb/tmdb';
import { SYNC_DATASOURCE } from '@/providers/syncDataSource';
import { DownloadJobsRepository } from '@/services/database/download-jobs';
import { MediasRepository } from '@/services/database/medias';
import { RequestsRepository } from '@/services/database/requests';
import { MediaIdentifierService } from '@/services/media-identifier';
import { MediaLabelizerService } from '@/services/media-labelizer';
import { PostDownloadService } from '@/services/post-download';

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

export const postDownloadProvider: Provider = {
  provide: PostDownloadService,
  inject: [JDownloaderApiService, DownloadJobsRepository, MediaIdentifierService, MediaLabelizerService, ConfigService],
  useFactory: (
    jdownloader: JDownloaderApiService,
    downloadJobs: DownloadJobsRepository,
    identification: MediaIdentifierService,
    placement: MediaLabelizerService,
    configService: ConfigService<Config, true>,
  ): PostDownloadService => {
    const mediaPaths = configService.get('mediaPaths');
    return new PostDownloadService(
      jdownloader,
      downloadJobs,
      identification,
      placement,
      mediaPaths.downloads,
      mediaPaths.jdownloaderOutput,
    );
  },
};

export const postDownloadProviders: Provider[] = [identificationProvider, placementProvider, postDownloadProvider];
