import { ConfigService } from '@nestjs/config';

import { JellyfinMediaService } from '@crn-flix/player-jellyfin';

import { Config } from '@/app.module';

export const jellyfinProvider = {
  provide: JellyfinMediaService,
  useFactory: async (configService: ConfigService<Config, true>): Promise<JellyfinMediaService> => {
    return await JellyfinMediaService.create(configService.get('jellyfin'));
  },
  inject: [ConfigService],
};
