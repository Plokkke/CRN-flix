import { ConfigService } from '@nestjs/config';

import { Config } from '@/app.module';
import { DarkiworldApi } from '@/modules/darkiworld/api';
import { DarkiworldService } from '@/modules/darkiworld/service';

export const darkiworldProvider = {
  provide: DarkiworldService,
  inject: [ConfigService],
  useFactory: (configService: ConfigService<Config, true>): DarkiworldService => {
    const api = new DarkiworldApi(configService.get('darkiworld'));
    return new DarkiworldService(api);
  },
};
