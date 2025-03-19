import { DiscordService } from '@/services/discord';
import { DiscordUserMessaging } from '@/services/messaging/user/discord';

export const discordUserMessagingProvider = {
  provide: DiscordUserMessaging,
  inject: [DiscordService],
  useFactory: async (discordService: DiscordService): Promise<DiscordUserMessaging> => {
    return new DiscordUserMessaging(discordService);
  },
};
