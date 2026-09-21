import { Logger } from '@nestjs/common';

import { UserEntity, UsersRepository, UserStatus } from '@/services/database/users';
import { ServiceNotice } from '@/services/messaging/user';
import { AllUserMessaging } from '@/services/messaging/user/all';

export type DeliveryResult = { user: UserEntity; outcome: 'sent' | 'failed'; error?: string };

export class AnnouncementService {
  private static readonly logger = new Logger(AnnouncementService.name);

  constructor(
    private readonly users: UsersRepository,
    private readonly messaging: AllUserMessaging,
  ) {}

  async listRecipients(): Promise<UserEntity[]> {
    const users = await this.users.list();
    return users
      .filter((user) => user.status === UserStatus.Active)
      .sort((a, b) => a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' }));
  }

  /** Delivers sequentially so one failing channel never hides the others' outcome. */
  async send(notice: ServiceNotice, userIds: string[]): Promise<DeliveryResult[]> {
    const wanted = new Set(userIds);
    const recipients = (await this.listRecipients()).filter((user) => wanted.has(user.id));
    AnnouncementService.logger.log(`Announcing "${notice.subject}" to ${recipients.length} user(s)`);

    const results: DeliveryResult[] = [];
    for (const user of recipients) {
      results.push(await this.deliver(notice, user));
    }
    return results;
  }

  private async deliver(notice: ServiceNotice, user: UserEntity): Promise<DeliveryResult> {
    try {
      await this.messaging.announce({ key: user.messagingKey, id: user.messagingId }, notice);
      return { user, outcome: 'sent' };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      AnnouncementService.logger.error(`Announcement to ${user.name} (${user.messagingKey}) failed: ${message}`);
      return { user, outcome: 'failed', error: message };
    }
  }
}
