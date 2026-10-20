import { Logger } from '@nestjs/common';

import { RequestsRepository } from '@/services/database/requests';
import { NotificationKey, UserNotificationsRepository } from '@/services/database/user-notifications';
import { UsersRepository } from '@/services/database/users';

import { AllUserMessaging, messagingContextOf } from './all';

/** Younger notices may still sit in a debounced batch (60s): leave them to it. */
const SETTLE_MS = 2 * 60 * 1000;
const BATCH_SIZE = 200;

/**
 * Re-queues the notifications the outbox still holds unsent: failed sends, batches lost to
 * a restart, everything kept back while in dry-run. A notification whose request has moved
 * on to another status is dropped (the newer status gets its own).
 */
export class NotificationRedeliveryService {
  private static readonly logger = new Logger(NotificationRedeliveryService.name);

  constructor(
    private readonly notifications: UserNotificationsRepository,
    private readonly requests: RequestsRepository,
    private readonly users: UsersRepository,
    private readonly messaging: AllUserMessaging,
  ) {}

  async redeliver(): Promise<void> {
    const pending = await this.notifications.listPending(new Date(Date.now() - SETTLE_MS), BATCH_SIZE);
    if (pending.length === 0) {
      return;
    }
    if (this.messaging.mode === 'dry-run') {
      NotificationRedeliveryService.logger.log(`DRY-RUN: ${pending.length}+ notification(s) kept queued`);
      return;
    }
    if (this.messaging.quietUntil()) {
      NotificationRedeliveryService.logger.debug(`Quiet hours: ${pending.length}+ notification(s) kept queued`);
      return;
    }
    NotificationRedeliveryService.logger.log(`Redelivering ${pending.length} queued notification(s)`);
    for (const key of pending) {
      await this.redeliverOne(key).catch((error: unknown) =>
        NotificationRedeliveryService.logger.error(
          `Failed to redeliver ${key.status} of ${key.mediaId} to ${key.userId}: ${error instanceof Error ? error.message : error}`,
        ),
      );
    }
  }

  private async redeliverOne(key: NotificationKey): Promise<void> {
    const [request, user] = await Promise.all([this.requests.get(key.mediaId), this.users.get(key.userId)]);
    if (!request || !user || request.status !== key.status) {
      await this.notifications.discard(key);
      return;
    }
    await this.messaging.requestUpdated(messagingContextOf(user), request);
  }
}
