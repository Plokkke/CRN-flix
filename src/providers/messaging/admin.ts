import { ConfigService } from '@nestjs/config';

import { Config } from '@/app.module';
import { MediaRequestRepository } from '@/services/database/mediaRequests';
import { DiscordService } from '@/services/discord';
import { DiscordAdminMessaging } from '@/services/messaging/admin/discord';

export const adminMessagingProvider = {
  provide: DiscordAdminMessaging,
  inject: [ConfigService, DiscordService, MediaRequestRepository],
  useFactory: async (
    configService: ConfigService<Config, true>,
    discordService: DiscordService,
    mediaRequestRepository: MediaRequestRepository,
  ): Promise<DiscordAdminMessaging> => {
    const adminConfig = configService.get<Config['administration']>('administration');
    return await DiscordAdminMessaging.create(
      { channelId: adminConfig.discordChannelId },
      discordService,
      mediaRequestRepository,
    );
  },
};
