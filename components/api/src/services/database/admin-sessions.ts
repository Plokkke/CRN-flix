import { Pool } from 'pg';

import { withDbRetry } from '@/helpers/db-retry';

export type AdminSessionEntity = {
  id: string;
  discordUserId: string;
  lastUsedAt: Date;
};

type AdminSessionRecord = {
  id: string;
  discord_user_id: string;
  last_used_at: Date;
};

export class AdminSessionsRepository {
  constructor(private readonly pool: Pool) {}

  async create(data: {
    tokenHash: string;
    discordUserId: string;
    userAgent: string | null;
    expiresAt: Date;
  }): Promise<void> {
    await withDbRetry(
      () =>
        this.pool.query(
          `INSERT INTO admin_sessions (token_hash, discord_user_id, user_agent, expires_at)
           VALUES ($1, $2, $3, $4)`,
          [data.tokenHash, data.discordUserId, data.userAgent, data.expiresAt],
        ),
      { label: 'adminSessions.create' },
    );
  }

  /** Returns the live session matching this token hash, or null when unknown, revoked or expired. */
  async getLive(tokenHash: string): Promise<AdminSessionEntity | null> {
    const result = await withDbRetry(
      () =>
        this.pool.query<AdminSessionRecord>(
          `SELECT id, discord_user_id, last_used_at
           FROM admin_sessions
           WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > NOW()`,
          [tokenHash],
        ),
      { label: 'adminSessions.getLive' },
    );
    const record = result.rows[0];
    return record ? { id: record.id, discordUserId: record.discord_user_id, lastUsedAt: record.last_used_at } : null;
  }

  /** Slides the expiry window forward so an actively used session never expires. */
  async touch(id: string, expiresAt: Date): Promise<void> {
    await withDbRetry(
      () =>
        this.pool.query(`UPDATE admin_sessions SET last_used_at = NOW(), expires_at = $2 WHERE id = $1`, [
          id,
          expiresAt,
        ]),
      { label: 'adminSessions.touch' },
    );
  }

  async revoke(tokenHash: string): Promise<void> {
    await withDbRetry(
      () => this.pool.query(`UPDATE admin_sessions SET revoked_at = NOW() WHERE token_hash = $1`, [tokenHash]),
      { label: 'adminSessions.revoke' },
    );
  }
}
