import { Pool } from 'pg';

import { withDbRetry } from '@/helpers/db-retry';
import { AssessedCandidate } from '@/services/planner/sourcing';

export type PlannerFindingEntity = {
  targetKey: string;
  candidates: AssessedCandidate[];
  referenced: boolean;
  foundAt: Date;
};

type PlannerFindingRecord = {
  target_key: string;
  candidates: AssessedCandidate[];
  referenced: boolean;
  found_at: Date;
};

const fromRecord = (record: PlannerFindingRecord): PlannerFindingEntity => ({
  targetKey: record.target_key,
  candidates: record.candidates,
  referenced: record.referenced,
  foundAt: record.found_at,
});

/** What the indexers answered for each target, as of the last planner pass. */
export class PlannerFindingsRepository {
  constructor(private readonly pool: Pool) {}

  async save(targetKey: string, candidates: AssessedCandidate[], referenced: boolean): Promise<void> {
    await withDbRetry(
      () =>
        this.pool.query(
          `INSERT INTO planner_findings (target_key, candidates, referenced, found_at)
           VALUES ($1, $2, $3, NOW())
           ON CONFLICT (target_key) DO UPDATE
           SET candidates = EXCLUDED.candidates, referenced = EXCLUDED.referenced, found_at = NOW()`,
          [targetKey, JSON.stringify(candidates), referenced],
        ),
      { label: 'plannerFindings.save' },
    );
  }

  async listAll(): Promise<PlannerFindingEntity[]> {
    const result = await withDbRetry(() => this.pool.query<PlannerFindingRecord>(`SELECT * FROM planner_findings`), {
      label: 'plannerFindings.listAll',
    });
    return result.rows.map(fromRecord);
  }

  async listByTargetKeys(targetKeys: string[]): Promise<PlannerFindingEntity[]> {
    if (targetKeys.length === 0) {
      return [];
    }
    const result = await withDbRetry(
      () =>
        this.pool.query<PlannerFindingRecord>(`SELECT * FROM planner_findings WHERE target_key = ANY($1)`, [
          targetKeys,
        ]),
      { label: 'plannerFindings.listByTargetKeys' },
    );
    return result.rows.map(fromRecord);
  }
}
