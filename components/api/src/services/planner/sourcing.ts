import { IndexerCandidate, isForceable, RejectReason } from '@/modules/indexer/contract';
import { EnginePreferences } from '@/modules/indexer/preferences';
import { scoreOf } from '@/services/indexer-scoring';

import { PlannerEpisode } from './model';
import { coversEpisode } from './resolve';

/** Why a missing episode is still missing, as far as the indexers are concerned. */
export enum Sourcing {
  /** A candidate passes the preferences: the planner can act. */
  Available = 'available',
  /** Best candidate fails only on quality/size: the admin can force it. */
  NonCompliant = 'non-compliant',
  /** Every candidate fails on host or language: nothing to force. */
  Unavailable = 'unavailable',
  /** The indexer knows the show but has no release covering this episode. */
  NotIndexed = 'not-indexed',
  /** No indexer has the show at all. */
  NotReferenced = 'not-referenced',
}

export type AssessedCandidate = { candidate: IndexerCandidate; reasons: RejectReason[] };

export type EpisodeSourcing = {
  sourcing: Sourcing;
  best: IndexerCandidate | null;
  bestRejected: AssessedCandidate | null;
};

const byScoreDesc =
  (prefs: EnginePreferences) =>
  (a: AssessedCandidate, b: AssessedCandidate): number =>
    scoreOf(b.candidate, prefs, false) - scoreOf(a.candidate, prefs, false);

/** Fewest reasons first (closest to eligible), then preference score. */
const byClosestToEligible =
  (prefs: EnginePreferences) =>
  (a: AssessedCandidate, b: AssessedCandidate): number =>
    a.reasons.length - b.reasons.length || byScoreDesc(prefs)(a, b);

export function assessSourcing(
  episode: PlannerEpisode,
  assessed: AssessedCandidate[],
  referenced: boolean,
  prefs: EnginePreferences,
): EpisodeSourcing {
  const covering = assessed.filter((a) => coversEpisode(a.candidate.scope, episode));
  const [best] = covering.filter((a) => a.reasons.length === 0).sort(byScoreDesc(prefs));
  if (best) {
    return { sourcing: Sourcing.Available, best: best.candidate, bestRejected: null };
  }

  const rejected = covering.sort(byClosestToEligible(prefs));
  const [forceable] = rejected.filter((a) => isForceable(a.reasons));
  if (forceable) {
    return { sourcing: Sourcing.NonCompliant, best: null, bestRejected: forceable };
  }
  if (rejected.length > 0) {
    return { sourcing: Sourcing.Unavailable, best: null, bestRejected: rejected[0] };
  }
  return { sourcing: referenced ? Sourcing.NotIndexed : Sourcing.NotReferenced, best: null, bestRejected: null };
}
