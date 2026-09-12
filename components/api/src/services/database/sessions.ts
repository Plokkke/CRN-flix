import { Pool } from 'pg';

import { withDbRetry } from '@/helpers/db-retry';

export type SessionEntity = {
  id: string;
  subjectId: string;
  lastUsedAt: Date;
};

type SessionRecord = {
  id: string;
  subject_id: string;
  last_used_at: Date;
};

/**
 * Opaque-token session store shared by every login area. Each area owns a table with the
 * same shape and a subject column naming who the session belongs to.
 */
export abstract class SessionsRepository {
  protected abstract readonly table: string;
  protected abstract readonly subjectColumn: string;

  constructor(private readonly pool: Pool) {}

  async create(data: {
    tokenHash: string;
    subjectId: string;
    userAgent: string | null;
    expiresAt: Date;
  }): Promise<void> {
    await withDbRetry(
      () =>
        this.pool.query(
          `INSERT INTO ${this.table} (token_hash, ${this.subjectColumn}, user_agent, expires_at)
           VALUES ($1, $2, $3, $4)`,
          [data.tokenHash, data.subjectId, data.userAgent, data.expiresAt],
        ),
      { label: `${this.table}.create` },
    );
  }

  /** Returns the live session matching this token hash, or null when unknown, revoked or expired. */
  async getLive(tokenHash: string): Promise<SessionEntity | null> {
    const result = await withDbRetry(
      () =>
        this.pool.query<SessionRecord>(
          `SELECT id, ${this.subjectColumn}::text AS subject_id, last_used_at
           FROM ${this.table}
           WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > NOW()`,
          [tokenHash],
        ),
      { label: `${this.table}.getLive` },
    );
    const record = result.rows[0];
    return record ? { id: record.id, subjectId: record.subject_id, lastUsedAt: record.last_used_at } : null;
  }

  /** Slides the expiry window forward so an actively used session never expires. */
  async touch(id: string, expiresAt: Date): Promise<void> {
    await withDbRetry(
      () =>
        this.pool.query(`UPDATE ${this.table} SET last_used_at = NOW(), expires_at = $2 WHERE id = $1`, [
          id,
          expiresAt,
        ]),
      { label: `${this.table}.touch` },
    );
  }

  async revoke(tokenHash: string): Promise<void> {
    await withDbRetry(
      () => this.pool.query(`UPDATE ${this.table} SET revoked_at = NOW() WHERE token_hash = $1`, [tokenHash]),
      { label: `${this.table}.revoke` },
    );
  }
}
