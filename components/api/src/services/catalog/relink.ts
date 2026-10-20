import { Logger } from '@nestjs/common';

import { CatalogAccountWatcher } from '@/services/catalog/accounts';
import { UserEntity, UsersRepository } from '@/services/database/users';
import { AllUserMessaging, messagingContextOf, UserMessagingDisabledError } from '@/services/messaging/user/all';

const describeError = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/**
 * Asks a user whose catalog account was revoked to link it again — once per revocation: the
 * ask is recorded only when delivered (a failed or dry-run send is tried again on a later
 * listing) and forgotten as soon as the account works again.
 */
export class CatalogRelinkService implements CatalogAccountWatcher {
  private static readonly logger = new Logger(CatalogRelinkService.name);

  /** Asks in flight or delivered since boot: listings run concurrently, with stale user rows. */
  private readonly asked = new Map<string, Promise<void> | 'delivered'>();

  constructor(
    private readonly users: UsersRepository,
    private readonly messaging: AllUserMessaging,
    private readonly catalogName: string,
  ) {}

  revoked(user: UserEntity): void {
    if (this.asked.has(user.id) || user.catalogRelinkRequestedAt) {
      return;
    }
    const ask: Promise<void> = this.ask(user).finally(() => {
      if (this.asked.get(user.id) === ask) {
        this.asked.delete(user.id);
      }
    });
    this.asked.set(user.id, ask);
  }

  usable(user: UserEntity): void {
    if (!this.asked.has(user.id) && !user.catalogRelinkRequestedAt) {
      return;
    }
    this.asked.delete(user.id);
    void this.users.setCatalogRelinkRequestedAt(user.id, null).then(
      () => CatalogRelinkService.logger.log(`User ${user.name}: ${this.catalogName} account works again`),
      (error: unknown) => CatalogRelinkService.logger.error(`User ${user.name}: ${describeError(error)}`),
    );
  }

  private async ask(user: UserEntity): Promise<void> {
    try {
      await this.messaging.catalogRelink(messagingContextOf(user), user.name, this.catalogName);
      this.asked.set(user.id, 'delivered');
      await this.users.setCatalogRelinkRequestedAt(user.id, new Date());
      CatalogRelinkService.logger.log(`User ${user.name}: asked to link ${this.catalogName} again`);
    } catch (error) {
      const level = error instanceof UserMessagingDisabledError ? 'log' : 'error';
      CatalogRelinkService.logger[level](`User ${user.name}: relink ask not delivered (${describeError(error)})`);
    }
  }
}
