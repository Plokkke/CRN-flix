import { Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { Config } from '@/app.module';
import { JDownloaderApiService } from '@/modules/jdownloader/jdownloader-api.service';

export const jdownloaderProvider: Provider = {
  provide: JDownloaderApiService,
  inject: [ConfigService],
  useFactory: (configService: ConfigService<Config, true>): JDownloaderApiService => {
    const config = configService.get('jdownloader');
    return new JDownloaderApiService(config);
  },
};
