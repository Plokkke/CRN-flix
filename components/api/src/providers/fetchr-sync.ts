import { Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { Config } from '@/app.module';
import { DownloadJobsRepository } from '@/services/database/download-jobs';
import { FetchrSyncService } from '@/services/fetchr-sync';

export const fetchrSyncProvider: Provider = {
  provide: FetchrSyncService,
  inject: [DownloadJobsRepository, ConfigService],
  useFactory: (downloadJobs: DownloadJobsRepository, configService: ConfigService<Config, true>): FetchrSyncService => {
    const fetchr = configService.get('fetchr');
    const mediaPaths = configService.get('mediaPaths');
    return new FetchrSyncService(downloadJobs, fetchr.url, fetchr.downloadsPrefix, mediaPaths.downloads, fetchr.apiKey);
  },
};
