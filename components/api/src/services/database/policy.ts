import { Pool } from 'pg';

import { Exemption, PolicyRuleRecord, RuleOutcome } from '@crn-flix/policy';

import { withDbRetry } from '@/helpers/db-retry';

type RuleRecord = {
  id: string;
  name: string;
  kind: string;
  audience: string;
  params: unknown;
  entries: unknown[];
};

/** Concrete rules and their lists; the kinds' schemas validate them when they are assessed. */
export class PolicyRulesRepository {
  constructor(private readonly pool: Pool) {}

  /** Enabled rules in evaluation order, each with its entries in creation order. */
  async listEnabled(): Promise<PolicyRuleRecord[]> {
    const result = await withDbRetry(
      () =>
        this.pool.query<RuleRecord>(
          `SELECT r.id, r.name, r.kind, r.audience, r.params,
                  COALESCE(json_agg(e.data ORDER BY e.created_at, e.id) FILTER (WHERE e.id IS NOT NULL), '[]') AS entries
           FROM policy_rules r
           LEFT JOIN policy_rule_entries e ON e.rule_id = r.id
           WHERE r.enabled
           GROUP BY r.id
           ORDER BY r.position, r.created_at, r.id`,
        ),
      { label: 'policyRules.listEnabled' },
    );
    return result.rows;
  }
}

/** Exemptions granted on titles; pending and denied ones are the appeal's history. */
export class PolicyExemptionsRepository {
  constructor(private readonly pool: Pool) {}

  async listGranted(imdbId: string): Promise<Exemption[]> {
    const result = await withDbRetry(
      () =>
        this.pool.query<{ user_id: string | null; rule_id: string | null }>(
          `SELECT user_id, rule_id FROM policy_exemptions WHERE imdb_id = $1 AND status = 'granted'`,
          [imdbId],
        ),
      { label: 'policyExemptions.listGranted' },
    );
    return result.rows.map((row) => ({ userId: row.user_id, ruleId: row.rule_id }));
  }
}

export type StoredAssessment = {
  outcomes: RuleOutcome[];
  fingerprint: string;
  assessedAt: Date;
};

/** The latest assessment of each title, keyed by the rules it was computed with. */
export class PolicyAssessmentsRepository {
  constructor(private readonly pool: Pool) {}

  async get(imdbId: string): Promise<StoredAssessment | null> {
    const result = await withDbRetry(
      () =>
        this.pool.query<{ outcomes: RuleOutcome[]; fingerprint: string; assessed_at: Date }>(
          `SELECT outcomes, fingerprint, assessed_at FROM policy_assessments WHERE imdb_id = $1`,
          [imdbId],
        ),
      { label: 'policyAssessments.get' },
    );
    const row = result.rows[0];
    return row ? { outcomes: row.outcomes, fingerprint: row.fingerprint, assessedAt: row.assessed_at } : null;
  }

  async save(imdbId: string, outcomes: RuleOutcome[], fingerprint: string): Promise<void> {
    await withDbRetry(
      () =>
        this.pool.query(
          `INSERT INTO policy_assessments (imdb_id, outcomes, fingerprint) VALUES ($1, $2, $3)
           ON CONFLICT (imdb_id) DO UPDATE
           SET outcomes = EXCLUDED.outcomes, fingerprint = EXCLUDED.fingerprint, assessed_at = NOW()`,
          [imdbId, JSON.stringify(outcomes), fingerprint],
        ),
      { label: 'policyAssessments.save' },
    );
  }

  /** Titles never assessed, assessed with other rules, or whose facts changed since; oldest first. */
  async listStale(fingerprint: string, limit: number): Promise<string[]> {
    const result = await withDbRetry(
      () =>
        this.pool.query<{ imdb_id: string }>(
          `SELECT m.imdb_id
           FROM (SELECT DISTINCT imdb_id FROM medias WHERE imdb_id <> '') m
           LEFT JOIN policy_assessments a ON a.imdb_id = m.imdb_id
           LEFT JOIN media_facts f ON f.imdb_id = m.imdb_id
           WHERE a.imdb_id IS NULL OR a.fingerprint <> $1 OR f.fetched_at > a.assessed_at
           ORDER BY a.assessed_at ASC NULLS FIRST
           LIMIT $2`,
          [fingerprint, limit],
        ),
      { label: 'policyAssessments.listStale' },
    );
    return result.rows.map((row) => row.imdb_id);
  }
}
