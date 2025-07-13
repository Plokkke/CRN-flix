import { FactoryProvider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { Config } from '@/app.module';
import { DiscordService } from '@/services/discord';

export const discordProvider: FactoryProvider<DiscordService> = {
  provide: DiscordService,
  inject: [ConfigService],
  useFactory: async (configService: ConfigService<Config, true>): Promise<DiscordService> => {
    const config = configService.get<Config['discord']>('discord');
    return await DiscordService.create(config);
  },
};
