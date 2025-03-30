import { ConfigService } from '@nestjs/config';

import { Config } from '@/app.module';
import { MediaRequestsRepository } from '@/services/database/mediaRequests';
import { UsersRepository } from '@/services/database/users';
import { DiscordService } from '@/services/discord';
import { DiscordAdminMessaging } from '@/services/messaging/admin/discord';

export const adminMessagingProvider = {
  provide: DiscordAdminMessaging,
  inject: [ConfigService, DiscordService, MediaRequestsRepository, UsersRepository],
  useFactory: async (
    configService: ConfigService<Config, true>,
    discordService: DiscordService,
    mediaRequestRepository: MediaRequestsRepository,
    usersRepository: UsersRepository,
  ): Promise<DiscordAdminMessaging> => {
    const adminConfig = configService.get<Config['administration']>('administration');
    return await DiscordAdminMessaging.create(
      { channelId: adminConfig.discordChannelId },
      discordService,
      mediaRequestRepository,
      usersRepository,
    );
  },
};
