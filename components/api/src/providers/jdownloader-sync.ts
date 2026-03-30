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
import { JdownloaderSyncService } from '@/services/jdownloader-sync';
import { MediaIdentifierService } from '@/services/media-identifier';
import { MediaLabelizerService } from '@/services/media-labelizer';

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

export const jdownloaderSyncProvider: Provider = {
  provide: JdownloaderSyncService,
  inject: [JDownloaderApiService, DownloadJobsRepository, MediaIdentifierService, MediaLabelizerService, ConfigService],
  useFactory: (
    jdownloader: JDownloaderApiService,
    downloadJobs: DownloadJobsRepository,
    identification: MediaIdentifierService,
    placement: MediaLabelizerService,
    configService: ConfigService<Config, true>,
  ): JdownloaderSyncService => {
    const mediaPaths = configService.get('mediaPaths');
    return new JdownloaderSyncService(
      jdownloader,
      downloadJobs,
      identification,
      placement,
      mediaPaths.downloads,
      mediaPaths.jdownloaderOutput,
    );
  },
};

export const jdownloaderSyncProviders: Provider[] = [
  identificationProvider,
  placementProvider,
  jdownloaderSyncProvider,
];
