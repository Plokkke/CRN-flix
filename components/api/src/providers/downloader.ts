import { Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { Downloader } from '@crn-flix/contracts';
import { FakeDownloader } from '@crn-flix/downloader-fake';
import { FetchrDownloader } from '@crn-flix/downloader-fetchr';

import { Config } from '@/app.module';
import { DownloadJobsRepository } from '@/services/database/download-jobs';
import { DownloadIntakeService } from '@/services/downloads/intake';

export const DOWNLOADER = Symbol('Downloader');

export type DownloaderChoice = { kind: 'fetchr' } | { kind: 'fake'; samplePath: string; durationMs: number };

export const downloaderProviders = (choice: DownloaderChoice): Provider[] => [
  {
    provide: DOWNLOADER,
    inject: [ConfigService],
    useFactory: (configService: ConfigService<Config, true>): Downloader => {
      const downloadsPath = configService.get('mediaPaths').downloads;
      return choice.kind === 'fake'
        ? new FakeDownloader({ downloadsPath, samplePath: choice.samplePath, durationMs: choice.durationMs })
        : new FetchrDownloader(configService.get('fetchr'), downloadsPath);
    },
  },
  {
    provide: DownloadIntakeService,
    inject: [DOWNLOADER, DownloadJobsRepository],
    useFactory: (downloader: Downloader, downloadJobs: DownloadJobsRepository): DownloadIntakeService =>
      new DownloadIntakeService(downloader, downloadJobs),
  },
];
