import { Pool } from 'pg';

import { Exemption, PolicyRuleRecord, Refusal, RuleOutcome } from '@crn-flix/policy';

import { withDbRetry } from '@/helpers/db-retry';

type RuleRecord = {
  id: string;
  name: string;
  kind: string;
  audience: string;
  params: unknown;
  entries: unknown[];
};

export type PolicyRuleEntity = {
  id: string;
  name: string;
  kind: string;
  audience: string;
  params: unknown;
  enabled: boolean;
  position: number;
  entryCount: number;
};

export type PolicyRuleEntryEntity = { id: string; data: unknown };

export type PolicyRuleInput = Pick<PolicyRuleEntity, 'name' | 'kind' | 'audience' | 'params' | 'enabled' | 'position'>;

type RuleRowRecord = Omit<PolicyRuleEntity, 'entryCount'> & { entry_count: number };

const fromRuleRow = ({ entry_count, ...rule }: RuleRowRecord): PolicyRuleEntity => ({
  ...rule,
  entryCount: entry_count,
});

const RULE_COLUMNS = `r.id, r.name, r.kind, r.audience, r.params, r.enabled, r.position,
  (SELECT COUNT(*)::int FROM policy_rule_entries e WHERE e.rule_id = r.id) AS entry_count`;

/** Concrete rules and their lists; the kinds' schemas validate them when they are assessed. */
export class PolicyRulesRepository {
  constructor(private readonly pool: Pool) {}

  async list(): Promise<PolicyRuleEntity[]> {
    const result = await this.pool.query<RuleRowRecord>(
      `SELECT ${RULE_COLUMNS} FROM policy_rules r ORDER BY r.position, r.created_at, r.id`,
    );
    return result.rows.map(fromRuleRow);
  }

  async get(id: string): Promise<PolicyRuleEntity | null> {
    const result = await this.pool.query<RuleRowRecord>(`SELECT ${RULE_COLUMNS} FROM policy_rules r WHERE r.id = $1`, [
      id,
    ]);
    return result.rows[0] ? fromRuleRow(result.rows[0]) : null;
  }

  async create(input: PolicyRuleInput): Promise<string> {
    const result = await this.pool.query<{ id: string }>(
      `INSERT INTO policy_rules (name, kind, audience, params, enabled, position)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [input.name, input.kind, input.audience, JSON.stringify(input.params), input.enabled, input.position],
    );
    return result.rows[0].id;
  }

  async update(id: string, input: Omit<PolicyRuleInput, 'kind'>): Promise<void> {
    await this.pool.query(
      `UPDATE policy_rules SET name = $2, audience = $3, params = $4, enabled = $5, position = $6, updated_at = NOW()
       WHERE id = $1`,
      [id, input.name, input.audience, JSON.stringify(input.params), input.enabled, input.position],
    );
  }

  async delete(id: string): Promise<void> {
    await this.pool.query(`DELETE FROM policy_rules WHERE id = $1`, [id]);
  }

  async listEntries(ruleId: string): Promise<PolicyRuleEntryEntity[]> {
    const result = await this.pool.query<PolicyRuleEntryEntity>(
      `SELECT id, data FROM policy_rule_entries WHERE rule_id = $1 ORDER BY created_at, id`,
      [ruleId],
    );
    return result.rows;
  }

  async addEntry(ruleId: string, data: unknown): Promise<void> {
    await this.pool.query(`INSERT INTO policy_rule_entries (rule_id, data) VALUES ($1, $2)`, [
      ruleId,
      JSON.stringify(data),
    ]);
  }

  async deleteEntry(ruleId: string, entryId: string): Promise<void> {
    await this.pool.query(`DELETE FROM policy_rule_entries WHERE rule_id = $1 AND id = $2`, [ruleId, entryId]);
  }

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

export type ExemptionStatus = 'pending' | 'granted' | 'denied';
export type ExemptionOrigin = 'contest' | 'exemption' | 'manual-download' | 'admin';

export type ExemptionRequest = {
  userId: string;
  imdbId: string;
  ruleIds: (string | null)[];
  origin: ExemptionOrigin;
  motivation: string;
  ticketId: string;
};

/** Exemptions granted on titles; pending and denied ones are the appeal's history. */
export class PolicyExemptionsRepository {
  constructor(private readonly pool: Pool) {}

  /** Every exemption granted for everyone, per title. */
  async listGrantedGlobal(): Promise<Map<string, Exemption[]>> {
    const result = await this.pool.query<{ imdb_id: string; rule_id: string | null }>(
      `SELECT imdb_id, rule_id FROM policy_exemptions WHERE status = 'granted' AND user_id IS NULL`,
    );
    return result.rows.reduce((byTitle, row) => {
      byTitle.set(row.imdb_id, [...(byTitle.get(row.imdb_id) ?? []), { userId: null, ruleId: row.rule_id }]);
      return byTitle;
    }, new Map<string, Exemption[]>());
  }

  /** One pending exemption per refusing rule (`ruleId` null: the admin's choice is what refuses). */
  async createPending(request: ExemptionRequest): Promise<void> {
    for (const ruleId of request.ruleIds) {
      await this.pool.query(
        `INSERT INTO policy_exemptions (user_id, imdb_id, rule_id, origin, status, motivation, ticket_id)
         VALUES ($1, $2, $3, $4, 'pending', $5, $6)`,
        [request.userId, request.imdbId, ruleId, request.origin, request.motivation, request.ticketId],
      );
    }
  }

  /** Settles the user's pending exemptions on the title; returns how many were pending. */
  async decidePending(
    userId: string,
    imdbId: string,
    status: 'granted' | 'denied',
    decidedBy: string,
  ): Promise<number> {
    const result = await this.pool.query(
      `UPDATE policy_exemptions SET status = $3, decided_by = $4, decided_at = NOW()
       WHERE user_id = $1 AND imdb_id = $2 AND status = 'pending'`,
      [userId, imdbId, status, decidedBy],
    );
    return result.rowCount ?? 0;
  }

  /** Lets the title through for everyone, from the given rules. */
  async grantGlobal(imdbId: string, ruleIds: string[], origin: ExemptionOrigin, decidedBy: string): Promise<void> {
    for (const ruleId of ruleIds) {
      await this.pool.query(
        `INSERT INTO policy_exemptions (user_id, imdb_id, rule_id, origin, status, decided_by, decided_at)
         VALUES (NULL, $1, $2, $3, 'granted', $4, NOW())`,
        [imdbId, ruleId, origin, decidedBy],
      );
    }
  }

  /** The latest appeal status of each title for one user. */
  async latestStatusByTitle(userId: string): Promise<Map<string, ExemptionStatus>> {
    const result = await this.pool.query<{ imdb_id: string; status: ExemptionStatus }>(
      `SELECT DISTINCT ON (imdb_id) imdb_id, status FROM policy_exemptions
       WHERE user_id = $1 ORDER BY imdb_id, created_at DESC`,
      [userId],
    );
    return new Map(result.rows.map((row) => [row.imdb_id, row.status]));
  }

  /** Users with a personal exemption granted, per title (their personal shelf shows it). */
  async listGrantedPersonal(): Promise<Map<string, string[]>> {
    const result = await this.pool.query<{ imdb_id: string; user_ids: string[] }>(
      `SELECT imdb_id, array_agg(DISTINCT user_id) AS user_ids FROM policy_exemptions
       WHERE status = 'granted' AND user_id IS NOT NULL GROUP BY imdb_id`,
    );
    return new Map(result.rows.map((row) => [row.imdb_id, row.user_ids]));
  }

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

export type TitledAssessment = { imdbId: string; outcomes: RuleOutcome[]; fingerprint: string; title: string };

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

  /** Every assessment, with the title's display names. */
  async listWithTitles(): Promise<TitledAssessment[]> {
    const result = await this.pool.query<{
      imdb_id: string;
      outcomes: RuleOutcome[];
      fingerprint: string;
      title: string | null;
      french_title: string | null;
    }>(
      `SELECT a.imdb_id, a.outcomes, a.fingerprint, m.title, m.french_title
       FROM policy_assessments a
       LEFT JOIN LATERAL (SELECT title, french_title FROM medias WHERE imdb_id = a.imdb_id LIMIT 1) m ON TRUE`,
    );
    return result.rows.map((row) => ({
      imdbId: row.imdb_id,
      outcomes: row.outcomes,
      fingerprint: row.fingerprint,
      title: row.french_title ?? row.title ?? row.imdb_id,
    }));
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

export type PolicyRefusalEntity = {
  userId: string;
  imdbId: string;
  refusals: Refusal[];
  refusedAt: Date;
  notifiedAt: Date | null;
};

type PolicyRefusalRecord = {
  user_id: string;
  imdb_id: string;
  refusals: Refusal[];
  refused_at: Date;
  notified_at: Date | null;
};

const fromRefusalRecord = (record: PolicyRefusalRecord): PolicyRefusalEntity => ({
  userId: record.user_id,
  imdbId: record.imdb_id,
  refusals: record.refusals,
  refusedAt: record.refused_at,
  notifiedAt: record.notified_at,
});

/** Titles refused to requesters: what to tell them, and whether they were told. */
export class PolicyRefusalsRepository {
  constructor(private readonly pool: Pool) {}

  /** A new or lifted refusal is told again; a holding one only gets its wording refreshed. */
  async record(userId: string, imdbId: string, refusals: Refusal[]): Promise<void> {
    await withDbRetry(
      () =>
        this.pool.query(
          `INSERT INTO policy_refusals (user_id, imdb_id, refusals) VALUES ($1, $2, $3)
           ON CONFLICT (user_id, imdb_id) DO UPDATE SET
             refusals = EXCLUDED.refusals,
             refused_at = CASE WHEN policy_refusals.lifted_at IS NULL THEN policy_refusals.refused_at ELSE NOW() END,
             notified_at = CASE WHEN policy_refusals.lifted_at IS NULL THEN policy_refusals.notified_at ELSE NULL END,
             lifted_at = NULL
           WHERE policy_refusals.lifted_at IS NOT NULL OR policy_refusals.refusals IS DISTINCT FROM EXCLUDED.refusals`,
          [userId, imdbId, JSON.stringify(refusals)],
        ),
      { label: 'policyRefusals.record' },
    );
  }

  async getHolding(userId: string, imdbId: string): Promise<PolicyRefusalEntity | null> {
    const result = await this.pool.query<PolicyRefusalRecord>(
      `SELECT user_id, imdb_id, refusals, refused_at, notified_at FROM policy_refusals
       WHERE user_id = $1 AND imdb_id = $2 AND lifted_at IS NULL`,
      [userId, imdbId],
    );
    return result.rows[0] ? fromRefusalRecord(result.rows[0]) : null;
  }

  async lift(userId: string, imdbId: string): Promise<void> {
    await withDbRetry(
      () =>
        this.pool.query(
          `UPDATE policy_refusals SET lifted_at = NOW() WHERE user_id = $1 AND imdb_id = $2 AND lifted_at IS NULL`,
          [userId, imdbId],
        ),
      { label: 'policyRefusals.lift' },
    );
  }

  /** Holding refusals nobody was told about yet, oldest first. */
  async listToNotify(limit: number): Promise<PolicyRefusalEntity[]> {
    const result = await this.pool.query<PolicyRefusalRecord>(
      `SELECT user_id, imdb_id, refusals, refused_at, notified_at FROM policy_refusals
       WHERE notified_at IS NULL AND lifted_at IS NULL ORDER BY refused_at LIMIT $1`,
      [limit],
    );
    return result.rows.map(fromRefusalRecord);
  }

  async markNotified(userId: string, imdbIds: string[]): Promise<void> {
    await this.pool.query(
      `UPDATE policy_refusals SET notified_at = NOW() WHERE user_id = $1 AND imdb_id = ANY($2) AND lifted_at IS NULL`,
      [userId, imdbIds],
    );
  }

  /** What still holds against one user, newest first. */
  async listHolding(userId: string): Promise<PolicyRefusalEntity[]> {
    const result = await this.pool.query<PolicyRefusalRecord>(
      `SELECT user_id, imdb_id, refusals, refused_at, notified_at FROM policy_refusals
       WHERE user_id = $1 AND lifted_at IS NULL ORDER BY refused_at DESC`,
      [userId],
    );
    return result.rows.map(fromRefusalRecord);
  }
}
