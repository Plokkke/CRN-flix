import { ConfigService } from '@nestjs/config';

import { Config } from '@/app.module';
import { ClickUpService } from '@/services/clickup';
import { RequestsRepository } from '@/services/database/requests';
import { UsersRepository } from '@/services/database/users';
import { DiscordService } from '@/services/discord';
import { ClickUpAdminMessaging } from '@/services/messaging/admin/clickup';
import { DiscordAdminMessaging } from '@/services/messaging/admin/discord';

export const adminMessagingProvider = {
  provide: DiscordAdminMessaging,
  inject: [ConfigService, DiscordService, UsersRepository],
  useFactory: async (
    configService: ConfigService<Config, true>,
    discordService: DiscordService,
    usersRepository: UsersRepository,
  ): Promise<DiscordAdminMessaging> => {
    const adminConfig = configService.get<Config['administration']>('administration');
    return await DiscordAdminMessaging.create(
      {
        channelId: adminConfig.discordChannelId,
        adminIds: adminConfig.adminIds,
      },
      discordService,
      usersRepository,
    );
  },
};

export const clickupAdminMessagingProvider = {
  provide: ClickUpAdminMessaging,
  inject: [ClickUpService, RequestsRepository],
  useFactory: async (
    clickupService: ClickUpService,
    requestsRepository: RequestsRepository,
  ): Promise<ClickUpAdminMessaging> => {
    return await ClickUpAdminMessaging.create(clickupService, requestsRepository);
  },
};
