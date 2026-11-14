import { Logger } from '@nestjs/common';

import { PolicyRefusalsRepository } from '@/services/database/policy';
import { UsersRepository } from '@/services/database/users';

import { PolicyService } from './policy';

/** Who among a title's requesters may have it: the planner plans for them only, notifications reach them only. */
export type RequesterGate = {
  admittedUserIds(imdbId: string, userIds: string[]): Promise<Set<string>>;
};

const describeError = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/**
 * Lets every requester through until the policy is enforced. Enforced, it admits each
 * requester per their profile and exemptions, records the refusals (told by the refusal
 * notices job) and lifts the ones that no longer hold. An admitted request also publishes a
 * title the admin downloaded for their own collection. A title that cannot be assessed
 * (metadata source down on a never-fetched title) admits nobody this time: the next pass retries.
 */
export class PolicyGate implements RequesterGate {
  private static readonly logger = new Logger(PolicyGate.name);

  constructor(
    private readonly policy: PolicyService,
    private readonly users: UsersRepository,
    private readonly refusals: PolicyRefusalsRepository,
    private readonly releaseManualHold: (imdbId: string) => Promise<unknown> = async () => false,
  ) {}

  async admittedUserIds(imdbId: string, userIds: string[]): Promise<Set<string>> {
    const admitted = await this.admitted(imdbId, [...new Set(userIds)]);
    if (admitted.size > 0) {
      await this.releaseManualHold(imdbId);
    }
    return admitted;
  }

  private async admitted(imdbId: string, userIds: string[]): Promise<Set<string>> {
    if (userIds.length === 0) {
      return new Set(userIds);
    }
    try {
      return await this.decide(imdbId, userIds);
    } catch (error) {
      PolicyGate.logger.warn(`Cannot assess ${imdbId}, nobody admitted for now: ${describeError(error)}`);
      return new Set();
    }
  }

  private async decide(imdbId: string, userIds: string[]): Promise<Set<string>> {
    const requesters = (await Promise.all(userIds.map((id) => this.users.get(id)))).filter((user) => user !== null);
    const admissions = await this.policy.admissionsOf(imdbId, requesters);
    if (!admissions) {
      return new Set(userIds);
    }
    const admitted = new Set<string>();
    for (const [userId, admission] of admissions) {
      if (admission.admitted) {
        admitted.add(userId);
        await this.refusals.lift(userId, imdbId);
      } else {
        await this.refusals.record(userId, imdbId, admission.refusals);
      }
    }
    return admitted;
  }
}
