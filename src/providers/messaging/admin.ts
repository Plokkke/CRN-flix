import { ConfigService } from '@nestjs/config';

import { Config } from '@/app.module';
import { DiscordService } from '@/services/discord';
import { DiscordAdminMessaging } from '@/services/messaging/admin/discord';

export const adminMessagingProvider = {
  provide: DiscordAdminMessaging,
  inject: [ConfigService, DiscordService],
  useFactory: async (
    configService: ConfigService<Config, true>,
    discordService: DiscordService,
  ): Promise<DiscordAdminMessaging> => {
    const adminConfig = configService.get<Config['administration']>('administration');
    return await DiscordAdminMessaging.create(discordService, { channelId: adminConfig.discordChannelId });
  },
};
