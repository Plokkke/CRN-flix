import { Logger } from '@nestjs/common';

import { PolicyRefusal } from '@crn-flix/contracts';

import { MediasRepository } from '@/services/database/medias';
import { PolicyRefusalEntity, PolicyRefusalsRepository } from '@/services/database/policy';
import { UsersRepository, UserStatus } from '@/services/database/users';
import { AllUserMessaging, messagingContextOf, UserMessagingDisabledError } from '@/services/messaging/user/all';

import { PolicyService } from './policy';

const BATCH = 100;

const describeError = (error: unknown): string => (error instanceof Error ? error.message : String(error));

function groupByUser(refusals: PolicyRefusalEntity[]): Map<string, PolicyRefusalEntity[]> {
  return refusals.reduce((byUser, refusal) => {
    byUser.set(refusal.userId, [...(byUser.get(refusal.userId) ?? []), refusal]);
    return byUser;
  }, new Map<string, PolicyRefusalEntity[]>());
}

/**
 * Tells requesters which titles the enforced policies refuse them, one message per user
 * for everything refused since the last one. A refusal counts as told only once a channel
 * delivered it: dry-run messaging, quiet hours and failures leave it for the next run.
 */
export class PolicyRefusalNotices {
  private static readonly logger = new Logger(PolicyRefusalNotices.name);

  constructor(
    private readonly policy: PolicyService,
    private readonly refusals: PolicyRefusalsRepository,
    private readonly users: UsersRepository,
    private readonly medias: MediasRepository,
    private readonly messaging: AllUserMessaging,
  ) {}

  async notify(): Promise<void> {
    if (this.policy.mode !== 'enforce') {
      return;
    }
    const pending = groupByUser(await this.refusals.listToNotify(BATCH));
    for (const [userId, refusals] of pending) {
      try {
        await this.notifyUser(userId, refusals);
      } catch (error) {
        if (error instanceof UserMessagingDisabledError) {
          return;
        }
        PolicyRefusalNotices.logger.warn(`Refusal notice to user ${userId} failed: ${describeError(error)}`);
      }
    }
  }

  private async notifyUser(userId: string, refusals: PolicyRefusalEntity[]): Promise<void> {
    const user = await this.users.get(userId);
    if (user?.status !== UserStatus.Active) {
      return;
    }
    const notices = await Promise.all(refusals.map((refusal) => this.noticeOf(refusal)));
    await this.messaging.policyRefused(messagingContextOf(user), user.name, notices);
    await this.refusals.markNotified(
      userId,
      refusals.map((refusal) => refusal.imdbId),
    );
    PolicyRefusalNotices.logger.log(`Told ${user.name} of ${refusals.length} refused title(s)`);
  }

  private async noticeOf(refusal: PolicyRefusalEntity): Promise<PolicyRefusal> {
    const titles = await this.medias.titlesOf(refusal.imdbId);
    return {
      title: titles?.frenchTitle ?? titles?.title ?? refusal.imdbId,
      year: titles?.year ?? null,
      posterUrl: null,
      policies: refusal.refusals.map((item) => ({ name: item.ruleName, notices: item.notices })),
      appealUrl: null,
    };
  }
}
