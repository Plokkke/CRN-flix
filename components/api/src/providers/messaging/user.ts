import { Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { Config } from '@/app.module';
import { ContextService } from '@/services/context';
import { DiscordService } from '@/services/discord';
import { DiscordUserMessaging } from '@/services/messaging/user/discord';
import { EmailUserMessaging } from '@/services/messaging/user/email';

const discordUserMessagingProvider = {
  provide: DiscordUserMessaging,
  inject: [DiscordService],
  useFactory: async (discordService: DiscordService): Promise<DiscordUserMessaging> => {
    return new DiscordUserMessaging(discordService);
  },
};

const emailUserMessagingProvider: Provider = {
  provide: EmailUserMessaging,
  inject: [ConfigService, ContextService],
  useFactory: async (
    configService: ConfigService<Config, true>,
    contextService: ContextService,
  ): Promise<EmailUserMessaging> => {
    const config = configService.get<Config['mailing']>('mailing');
    return new EmailUserMessaging(config, contextService);
  },
};

export const userMessagingProviders = [discordUserMessagingProvider, emailUserMessagingProvider];
