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
 * notices job) and lifts the ones that no longer hold. A title that cannot be assessed
 * (metadata source down on a never-fetched title) admits nobody this time: the next pass retries.
 */
export class PolicyGate implements RequesterGate {
  private static readonly logger = new Logger(PolicyGate.name);

  constructor(
    private readonly policy: PolicyService,
    private readonly users: UsersRepository,
    private readonly refusals: PolicyRefusalsRepository,
  ) {}

  async admittedUserIds(imdbId: string, userIds: string[]): Promise<Set<string>> {
    const unique = [...new Set(userIds)];
    if (this.policy.mode !== 'enforce' || unique.length === 0) {
      return new Set(unique);
    }
    try {
      return await this.decide(imdbId, unique);
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
