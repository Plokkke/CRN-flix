import { ConfigService } from '@nestjs/config';

import { Config } from '@/app.module';
import { JellyfinMediaService } from '@/modules/jellyfin/jellyfin';

export const jellyfinProvider = {
  provide: JellyfinMediaService,
  useFactory: async (configService: ConfigService<Config, true>): Promise<JellyfinMediaService> => {
    return await JellyfinMediaService.create(configService.get('jellyfin'));
  },
  inject: [ConfigService],
};
