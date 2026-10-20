import { Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { Downloader } from '@crn-flix/contracts';
import { FetchrDownloader } from '@crn-flix/downloader-fetchr';

import { Config } from '@/app.module';
import { DownloadJobsRepository } from '@/services/database/download-jobs';
import { DownloadIntakeService } from '@/services/downloads/intake';

export const DOWNLOADER = Symbol('Downloader');

export const downloaderProviders: Provider[] = [
  {
    provide: DOWNLOADER,
    inject: [ConfigService],
    useFactory: (configService: ConfigService<Config, true>): Downloader =>
      new FetchrDownloader(configService.get('fetchr'), configService.get('mediaPaths').downloads),
  },
  {
    provide: DownloadIntakeService,
    inject: [DOWNLOADER, DownloadJobsRepository],
    useFactory: (downloader: Downloader, downloadJobs: DownloadJobsRepository): DownloadIntakeService =>
      new DownloadIntakeService(downloader, downloadJobs),
  },
];
