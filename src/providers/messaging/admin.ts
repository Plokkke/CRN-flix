import { ConfigService } from '@nestjs/config';

import { Config } from '@/app.module';
import { MediasRepository } from '@/services/database/medias';
import { RequestsRepository } from '@/services/database/requests';
import { UsersRepository } from '@/services/database/users';
import { DiscordService } from '@/services/discord';
import { DiscordAdminMessaging } from '@/services/messaging/admin/discord';

export const adminMessagingProvider = {
  provide: DiscordAdminMessaging,
  inject: [ConfigService, DiscordService, MediasRepository, RequestsRepository, UsersRepository],
  useFactory: async (
    configService: ConfigService<Config, true>,
    discordService: DiscordService,
    mediasRepository: MediasRepository,
    requestsRepository: RequestsRepository,
    usersRepository: UsersRepository,
  ): Promise<DiscordAdminMessaging> => {
    const adminConfig = configService.get<Config['administration']>('administration');
    return await DiscordAdminMessaging.create(
      {
        channelId: adminConfig.discordChannelId,
        adminIds: adminConfig.adminIds,
      },
      discordService,
      mediasRepository,
      requestsRepository,
      usersRepository,
    );
  },
};
