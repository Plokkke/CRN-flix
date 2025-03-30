import { Config } from '@/app.module';
import { DiscordService } from '@/services/discord';
import { DiscordUserMessaging } from '@/services/messaging/user/discord';
import { EmailUserMessaging } from '@/services/messaging/user/email';
import { ConfigService } from '@nestjs/config';

const discordUserMessagingProvider = {
  provide: DiscordUserMessaging,
  inject: [DiscordService],
  useFactory: async (discordService: DiscordService): Promise<DiscordUserMessaging> => {
    return new DiscordUserMessaging(discordService);
  },
};

const emailUserMessagingProvider = {
  provide: EmailUserMessaging,
  inject: [ConfigService],
  useFactory: async (configService: ConfigService<Config, true>): Promise<EmailUserMessaging> => {
    const config = configService.get<Config['mailing']>('mailing');
    return new EmailUserMessaging(config);
  },
};

export const userMessagingProviders = [discordUserMessagingProvider, emailUserMessagingProvider];