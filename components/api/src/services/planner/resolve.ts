import { CandidateScope, IndexerCandidate, scopeKey } from '@/modules/indexer/contract';
import { EnginePreferences, maxSizeBytes } from '@/modules/indexer/preferences';
import { scoreOf } from '@/services/indexer-scoring';

import { maxLabel, PlanLabel, PlannerEpisode, runtimeHoursOf, urgencyOf } from './model';

const BYTES_PER_GB = 1024 ** 3;

export type ResolveWeights = {
  /** α — admin effort per action; favors packs. */
  actionCost: number;
  /** β — cost per redundant GB (overlap with already-available episodes). */
  redundantGbCost: number;
  /** γ — cost per viewing-hour beyond the soft ceiling. */
  excessHourCost: number;
};

/**
 * Calibrated on the canonical cases: Daredevil complete (~33h) must win as a single
 * action against 3 season packs; SG-1 (~160h) must lose to its season packs.
 */
export const DEFAULT_WEIGHTS: ResolveWeights = {
  actionCost: 1,
  redundantGbCost: 0.02,
  excessHourCost: 0.15,
};

export type ChosenAction = {
  candidate: IndexerCandidate;
  /** Missing episodes the action satisfies — urgent ones plus deferred free bonus. */
  coveredMediaIds: string[];
  /** Max urgency among the missing episodes covered. */
  label: PlanLabel;
  /** Runners-up covering the same wanted episodes, for the admin to arbitrate. */
  alternatives: IndexerCandidate[];
};

export type ResolveInput = {
  /** Every known episode of the show (movies: the single degenerate episode). */
  episodes: PlannerEpisode[];
  /** Labels of the missing episodes, from `labelEpisodes`. */
  labels: Map<string, PlanLabel>;
  candidates: IndexerCandidate[];
  maxWindowHours: number;
  prefs: EnginePreferences;
  weights?: ResolveWeights;
};

const MAX_ALTERNATIVES = 2;

type ScoredCandidate = {
  candidate: IndexerCandidate;
  coveredMissing: PlannerEpisode[];
  coveredWanted: PlannerEpisode[];
  cost: number;
};

export function coversEpisode(scope: CandidateScope, episode: PlannerEpisode): boolean {
  switch (scope.kind) {
    case 'movie':
    case 'series':
      return true;
    case 'season':
      return episode.season === scope.season;
    case 'episode':
      return episode.season === scope.season && episode.episode === scope.episode;
  }
}

function estimateSizeBytes(candidate: IndexerCandidate, coveredMinutes: number, prefs: EnginePreferences): number {
  if (candidate.sizeBytes !== null) {
    return candidate.sizeBytes;
  }
  return maxSizeBytes(candidate.quality, coveredMinutes, prefs.sizePolicy) ?? 0;
}

function scoreCandidate(
  candidate: IndexerCandidate,
  input: Required<Pick<ResolveInput, 'episodes' | 'labels' | 'maxWindowHours' | 'prefs' | 'weights'>>,
): ScoredCandidate | null {
  const covered = input.episodes.filter((e) => coversEpisode(candidate.scope, e));
  const coveredMissing = covered.filter((e) => e.requested && !e.available);
  const coveredWanted = coveredMissing.filter((e) => urgencyOf(input.labels.get(e.mediaId) ?? PlanLabel.Deferred) > 0);
  if (coveredWanted.length === 0) {
    return null;
  }

  const coveredHours = covered.reduce((acc, e) => acc + runtimeHoursOf(e), 0);
  const newHours = coveredMissing.reduce((acc, e) => acc + runtimeHoursOf(e), 0);
  const redundantHours = covered.filter((e) => e.available).reduce((acc, e) => acc + runtimeHoursOf(e), 0);

  const sizeBytes = estimateSizeBytes(candidate, coveredHours * 60, input.prefs);
  const redundantBytes = coveredHours > 0 ? sizeBytes * (redundantHours / coveredHours) : 0;

  const cost =
    input.weights.actionCost +
    input.weights.redundantGbCost * (redundantBytes / BYTES_PER_GB) +
    input.weights.excessHourCost * Math.max(0, newHours - input.maxWindowHours);

  return { candidate, coveredMissing, coveredWanted, cost };
}

/**
 * Weighted set cover over the wanted episodes. Instances are tiny (tens of
 * candidates): greedy by cost/new-coverage ratio, then a domination prune so
 * a chosen pack silently absorbs the singles it made pointless.
 */
export function resolvePlan(input: ResolveInput): ChosenAction[] {
  const context = {
    episodes: input.episodes,
    labels: input.labels,
    maxWindowHours: input.maxWindowHours,
    prefs: input.prefs,
    weights: input.weights ?? DEFAULT_WEIGHTS,
  };

  const scored = input.candidates
    .map((candidate) => scoreCandidate(candidate, context))
    .filter((s): s is ScoredCandidate => s !== null)
    // Deterministic greedy: on equal cost ratios, preference order (quality, language) wins.
    .sort(
      (a, b) => a.cost - b.cost || scoreOf(b.candidate, input.prefs, false) - scoreOf(a.candidate, input.prefs, false),
    );

  const wantedIds = new Set(scored.flatMap((s) => s.coveredWanted.map((e) => e.mediaId)));
  const remaining = new Set(wantedIds);
  const picked: ScoredCandidate[] = [];

  while (remaining.size > 0) {
    let best: { scored: ScoredCandidate; newCover: string[]; ratio: number } | null = null;
    for (const s of scored) {
      if (picked.includes(s)) {
        continue;
      }
      const newCover = s.coveredWanted.map((e) => e.mediaId).filter((id) => remaining.has(id));
      if (newCover.length === 0) {
        continue;
      }
      const ratio = s.cost / newCover.length;
      if (!best || ratio < best.ratio) {
        best = { scored: s, newCover, ratio };
      }
    }
    if (!best) {
      break;
    }
    picked.push(best.scored);
    best.newCover.forEach((id) => remaining.delete(id));
  }

  prunedDominated(picked);

  return picked.map((s) => toAction(s, scored, context.labels));
}

/** Drop actions whose wanted coverage is contained in the union of the others (costliest first). */
function prunedDominated(picked: ScoredCandidate[]): void {
  let changed = true;
  while (changed) {
    changed = false;
    const byCostDesc = [...picked].sort((a, b) => b.cost - a.cost);
    for (const action of byCostDesc) {
      const othersCover = new Set(
        picked.filter((p) => p !== action).flatMap((p) => p.coveredWanted.map((e) => e.mediaId)),
      );
      if (action.coveredWanted.every((e) => othersCover.has(e.mediaId))) {
        picked.splice(picked.indexOf(action), 1);
        changed = true;
        break;
      }
    }
  }
}

function toAction(scored: ScoredCandidate, all: ScoredCandidate[], labels: Map<string, PlanLabel>): ChosenAction {
  const wantedIds = new Set(scored.coveredWanted.map((e) => e.mediaId));
  const label = scored.coveredMissing
    .map((e) => labels.get(e.mediaId) ?? PlanLabel.Deferred)
    .reduce(maxLabel, PlanLabel.Deferred);

  const alternatives = all
    .filter(
      (other) =>
        other !== scored &&
        scopeKey(other.candidate.scope) !== scopeKey(scored.candidate.scope) &&
        [...wantedIds].every((id) => other.coveredWanted.some((e) => e.mediaId === id)),
    )
    .slice(0, MAX_ALTERNATIVES)
    .map((other) => other.candidate);

  return {
    candidate: scored.candidate,
    coveredMediaIds: scored.coveredMissing.map((e) => e.mediaId),
    label,
    alternatives,
  };
}
