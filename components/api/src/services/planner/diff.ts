import { CandidateScope, scopeKey } from '@/modules/indexer/contract';

import { ChosenAction } from './resolve';

/** The persisted shape diffing needs — a projection of `planned_downloads` live rows. */
export type LiveAction = {
  id: string;
  scope: CandidateScope;
  status: 'proposed' | 'downloading';
  coveredMediaIds: string[];
};

export type PlanDiff<L extends LiveAction = LiveAction> = {
  create: ChosenAction[];
  refresh: { live: L; chosen: ChosenAction }[];
  supersede: L[];
  /** Live actions absorbed as admin free-will: not in the optimal plan but not dominated. */
  keep: L[];
};

/**
 * Level-based reconciliation of the freshly resolved plan against the live actions.
 * Identity is the scope within the show: "download the S1 pack" stays the same action
 * even when the re-scan swapped its best candidate link.
 */
export function diffPlan<L extends LiveAction>(
  chosen: ChosenAction[],
  live: L[],
  stillMissingMediaIds: Set<string>,
): PlanDiff<L> {
  const chosenByScope = new Map(chosen.map((action) => [scopeKey(action.candidate.scope), action]));
  const liveScopes = new Set(live.map((action) => scopeKey(action.scope)));

  const plannedCoverage = new Set(chosen.flatMap((action) => action.coveredMediaIds));

  const diff: PlanDiff<L> = { create: [], refresh: [], supersede: [], keep: [] };

  for (const action of live) {
    const match = chosenByScope.get(scopeKey(action.scope));
    if (match) {
      diff.refresh.push({ live: action, chosen: match });
      continue;
    }

    const relevantCoverage = action.coveredMediaIds.filter((id) => stillMissingMediaIds.has(id));
    const dominated = relevantCoverage.every((id) => plannedCoverage.has(id));
    if (dominated) {
      diff.supersede.push(action);
    } else {
      diff.keep.push(action);
    }
  }

  diff.create = chosen.filter((action) => !liveScopes.has(scopeKey(action.candidate.scope)));

  return diff;
}
