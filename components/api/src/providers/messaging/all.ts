import { ConfigService } from '@nestjs/config';

import { EmailChannel } from '@crn-flix/messaging-user-email';

import { Config } from '@/app.module';
import { ScheduledAnnouncementsService } from '@/services/announcements/scheduled';
import { AnnouncementService } from '@/services/announcements/service';
import { ContextService } from '@/services/context';
import { RequestsRepository } from '@/services/database/requests';
import { ScheduledAnnouncementsRepository } from '@/services/database/scheduled-announcements';
import { UserMessagesRepository } from '@/services/database/user-messages';
import { UserNotificationsRepository } from '@/services/database/user-notifications';
import { UsersRepository } from '@/services/database/users';
import { AllUserMessaging } from '@/services/messaging/user/all';
import { QuietHours } from '@/services/messaging/user/quiet-hours';
import { NotificationRedeliveryService } from '@/services/messaging/user/redelivery';

export const quietHoursProvider = {
  provide: QuietHours,
  inject: [ConfigService],
  useFactory: (configService: ConfigService<Config, true>): QuietHours =>
    new QuietHours(configService.get('userMessaging').quietHours),
};

export const allUserMessagingProvider = {
  provide: AllUserMessaging,
  inject: [ConfigService, ContextService, UserNotificationsRepository, UserMessagesRepository, QuietHours],
  useFactory: (
    configService: ConfigService<Config, true>,
    context: ContextService,
    notifications: UserNotificationsRepository,
    journal: UserMessagesRepository,
    quietHours: QuietHours,
  ): AllUserMessaging => {
    const channels = [new EmailChannel(configService.get('mailing'), context.identity)];
    const { mode } = configService.get('userMessaging');
    return new AllUserMessaging(channels, context, notifications, journal, mode, quietHours);
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

export const scheduledAnnouncementsProvider = {
  provide: ScheduledAnnouncementsService,
  inject: [ScheduledAnnouncementsRepository, AnnouncementService, QuietHours],
  useFactory: (
    repository: ScheduledAnnouncementsRepository,
    announcements: AnnouncementService,
    quietHours: QuietHours,
  ): ScheduledAnnouncementsService => new ScheduledAnnouncementsService(repository, announcements, quietHours),
};
