import { ConfigService } from '@nestjs/config';

import { EmailChannel } from '@crn-flix/messaging-user-email';

import { Config } from '@/app.module';
import { AnnouncementService } from '@/services/announcements/service';
import { ContextService } from '@/services/context';
import { RequestsRepository } from '@/services/database/requests';
import { UserNotificationsRepository } from '@/services/database/user-notifications';
import { UsersRepository } from '@/services/database/users';
import { AllUserMessaging } from '@/services/messaging/user/all';
import { NotificationRedeliveryService } from '@/services/messaging/user/redelivery';

export const allUserMessagingProvider = {
  provide: AllUserMessaging,
  inject: [ConfigService, ContextService, UserNotificationsRepository],
  useFactory: (
    configService: ConfigService<Config, true>,
    context: ContextService,
    notifications: UserNotificationsRepository,
  ): AllUserMessaging => {
    const identity = { serviceName: context.name, playerUrl: context.mediaServerUrl };
    const channels = [new EmailChannel(configService.get('mailing'), identity)];
    return new AllUserMessaging(channels, context, notifications, configService.get('userMessaging').mode);
  },
};

export const notificationRedeliveryProvider = {
  provide: NotificationRedeliveryService,
  inject: [UserNotificationsRepository, RequestsRepository, UsersRepository, AllUserMessaging],
  useFactory: (
    notifications: UserNotificationsRepository,
    requests: RequestsRepository,
    users: UsersRepository,
    messaging: AllUserMessaging,
  ): NotificationRedeliveryService => new NotificationRedeliveryService(notifications, requests, users, messaging),
};

export const announcementProvider = {
  provide: AnnouncementService,
  inject: [UsersRepository, AllUserMessaging],
  useFactory: (users: UsersRepository, messaging: AllUserMessaging): AnnouncementService =>
    new AnnouncementService(users, messaging),
};
