import { ConfigService } from '@nestjs/config';

import { JellyfinMediaService } from '@crn-flix/player-jellyfin';

import { Config } from '@/app.module';
import { ContextService } from '@/services/context';

export const contextProvider = {
  provide: ContextService,
  inject: [ConfigService, JellyfinMediaService],
  useFactory: (configService: ConfigService<Config, true>, jellyfin: JellyfinMediaService): ContextService => {
    return new ContextService(configService, jellyfin);
  },
};
