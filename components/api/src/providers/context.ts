import { ConfigService } from '@nestjs/config';

import { Config } from '@/app.module';
import { JellyfinMediaService } from '@/modules/jellyfin/jellyfin';
import { ContextService } from '@/services/context';

export const contextProvider = {
  provide: ContextService,
  inject: [ConfigService, JellyfinMediaService],
  useFactory: (configService: ConfigService<Config, true>, jellyfin: JellyfinMediaService): ContextService => {
    return new ContextService(configService, jellyfin);
  },
};
