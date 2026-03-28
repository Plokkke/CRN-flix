import { ConfigService } from '@nestjs/config';

import { Config } from '@/app.module';
import { DiscordService } from '@/modules/discord/discord';
import { RequestsRepository } from '@/services/database/requests';
import { UsersRepository } from '@/services/database/users';
import { DiscordAdminMessaging } from '@/services/messaging/admin/discord';

export const adminMessagingProvider = {
  provide: DiscordAdminMessaging,
  inject: [ConfigService, DiscordService, UsersRepository, RequestsRepository],
  useFactory: async (
    configService: ConfigService<Config, true>,
    discordService: DiscordService,
    usersRepository: UsersRepository,
    requestsRepository: RequestsRepository,
  ): Promise<DiscordAdminMessaging> => {
    const adminConfig = configService.get<Config['administration']>('administration');
    return await DiscordAdminMessaging.create(
      {
        channelId: adminConfig.discordChannelId,
        adminIds: adminConfig.adminIds,
      },
      discordService,
      usersRepository,
      requestsRepository,
    );
  },
};
