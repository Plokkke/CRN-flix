import { RequestReason } from './catalog';
import { MediaItem } from './media';
import { MediaMetadata } from './metadata';

/** Everything a policy may look at: the media, what is known about it, who wants it and why. */
export type PolicySubject = {
  media: MediaItem;
  metadata: MediaMetadata | null;
  requester: { userRef: string; reasons: RequestReason[] };
};

export type PolicyDecision =
  | { verdict: 'accept' }
  | { verdict: 'reject'; rule: string; reason: string }
  | { verdict: 'review'; rule: string; reason: string };

/**
 * DRAFT — not wired yet. Filters requests as they come out of the catalogs, before planning.
 * Pure and synchronous: no I/O, the engine supplies everything in the subject.
 * `reject` closes the request (user notified with `reason`), `review` summons an admin.
 */
export interface Policy {
  readonly name: string;
  evaluate(subject: PolicySubject): PolicyDecision;
}

const ACCEPT: PolicyDecision = { verdict: 'accept' };

/** Runs policies in order; the first non-accepting verdict wins. */
export function evaluatePolicies(policies: readonly Policy[], subject: PolicySubject): PolicyDecision {
  for (const policy of policies) {
    const decision = policy.evaluate(subject);
    if (decision.verdict !== 'accept') {
      return decision;
    }
  }
  return ACCEPT;
}
