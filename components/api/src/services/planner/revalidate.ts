import { assessCandidate, IndexerTarget, RejectReason } from '@/modules/indexer/contract';
import { EnginePreferences } from '@/modules/indexer/preferences';
import { PlannedDownloadEntity, PlannedDownloadStatus } from '@/services/database/planned-downloads';
import { candidateOf } from '@/services/indexer-link';

export type StaleAction = { action: PlannedDownloadEntity; reasons: RejectReason[] };

/**
 * Proposals whose release no longer passes the current preferences (rules tightened,
 * a runtime learnt since, an override removed). Downloads already running are left alone:
 * the admin acted on them.
 */
export function staleProposals(
  live: PlannedDownloadEntity[],
  target: IndexerTarget,
  prefs: EnginePreferences,
): StaleAction[] {
  return live
    .filter((action) => action.status === PlannedDownloadStatus.Proposed)
    .map((action) => ({ action, reasons: assessCandidate(candidateOf(action), target, prefs) }))
    .filter((stale) => stale.reasons.length > 0);
}
