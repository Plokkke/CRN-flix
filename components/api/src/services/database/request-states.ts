import { Pool } from 'pg';

import { withDbRetry } from '@/helpers/db-retry';
import { transaction } from '@/helpers/sql';
import { IndexerCandidate } from '@/modules/indexer/contract';
import { PlanLabel } from '@/services/planner/model';
import { AssessedCandidate, Sourcing } from '@/services/planner/sourcing';

export type RequestStateEntity = {
  mediaId: string;
  urgency: PlanLabel;
  sourcing: Sourcing;
  bestCandidate: IndexerCandidate | null;
  bestRejected: AssessedCandidate | null;
  actionId: string | null;
  plannedAt: Date;
};

export type NewRequestState = Omit<RequestStateEntity, 'plannedAt'>;

type RequestStateRecord = {
  media_id: string;
  urgency: PlanLabel;
  sourcing: Sourcing;
  best_candidate: IndexerCandidate | null;
  best_rejected: AssessedCandidate | null;
  action_id: string | null;
  planned_at: Date;
};

const fromRecord = (record: RequestStateRecord): RequestStateEntity => ({
  mediaId: record.media_id,
  urgency: record.urgency,
  sourcing: record.sourcing,
  bestCandidate: record.best_candidate,
  bestRejected: record.best_rejected,
  actionId: record.action_id,
  plannedAt: record.planned_at,
});

/** The planner's read model: rewritten per target at the end of each pass. */
export class RequestStatesRepository {
  constructor(private readonly pool: Pool) {}

  /** Replaces the states of a target: rows for `states`, nothing for the other `targetMediaIds`. */
  async replaceForTarget(targetMediaIds: string[], states: NewRequestState[]): Promise<void> {
    const keep = new Set(states.map((s) => s.mediaId));
    const stale = targetMediaIds.filter((id) => !keep.has(id));

    await transaction(this.pool, async (client) => {
      if (stale.length > 0) {
        await client.query(`DELETE FROM media_request_states WHERE media_id = ANY($1)`, [stale]);
      }
      for (const state of states) {
        await client.query(
          `INSERT INTO media_request_states (media_id, urgency, sourcing, best_candidate, best_rejected, action_id, planned_at)
           VALUES ($1, $2, $3, $4, $5, $6, NOW())
           ON CONFLICT (media_id) DO UPDATE SET
             urgency = EXCLUDED.urgency, sourcing = EXCLUDED.sourcing,
             best_candidate = EXCLUDED.best_candidate, best_rejected = EXCLUDED.best_rejected,
             action_id = EXCLUDED.action_id, planned_at = NOW()`,
          [
            state.mediaId,
            state.urgency,
            state.sourcing,
            JSON.stringify(state.bestCandidate),
            JSON.stringify(state.bestRejected),
            state.actionId,
          ],
        );
      }
    });
  }

  async listAll(): Promise<RequestStateEntity[]> {
    const result = await withDbRetry(() => this.pool.query<RequestStateRecord>(`SELECT * FROM media_request_states`), {
      label: 'requestStates.listAll',
    });
    return result.rows.map(fromRecord);
  }

  /** When the planner last wrote anything: the dashboard's "last pass" indicator. */
  async latestPlannedAt(): Promise<Date | null> {
    const result = await withDbRetry(
      () =>
        this.pool.query<{ planned_at: Date | null }>(`SELECT MAX(planned_at) AS planned_at FROM media_request_states`),
      { label: 'requestStates.latestPlannedAt' },
    );
    return result.rows[0]?.planned_at ?? null;
  }
}
