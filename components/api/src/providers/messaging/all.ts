import { ConfigService } from '@nestjs/config';

import { EmailChannel } from '@crn-flix/messaging-user-email';

import { Config } from '@/app.module';
import { AnnouncementService } from '@/services/announcements/service';
import { ContextService } from '@/services/context';
import { UsersRepository } from '@/services/database/users';
import { AllUserMessaging } from '@/services/messaging/user/all';

export const allUserMessagingProvider = {
  provide: AllUserMessaging,
  inject: [ConfigService, ContextService],
  useFactory: (configService: ConfigService<Config, true>, context: ContextService): AllUserMessaging => {
    const identity = { serviceName: context.name, playerUrl: context.mediaServerUrl };
    return new AllUserMessaging([new EmailChannel(configService.get('mailing'), identity)], context);
  },
};

export const announcementProvider = {
  provide: AnnouncementService,
  inject: [UsersRepository, AllUserMessaging],
  useFactory: (users: UsersRepository, messaging: AllUserMessaging): AnnouncementService =>
    new AnnouncementService(users, messaging),
};
