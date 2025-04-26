import { DateTime } from 'luxon';
import { Pool } from 'pg';

import { RequestKind } from '@/services/sync';

export type UserActivity = Record<RequestKind, DateTime<true> | null>;

export class UserActivitiesRepository {
  constructor(private readonly pool: Pool) {}

  async upsert(userId: string, requestKind: RequestKind): Promise<void> {
    const query = `
        INSERT INTO user_activities (user_id, type, updated_at)
        VALUES ($1, $2, CURRENT_TIMESTAMP)
        ON CONFLICT (user_id, type)
        DO UPDATE SET updated_at = CURRENT_TIMESTAMP
      `;

    await this.pool.query(query, [userId, requestKind]);
  }

  async getForUserId(userId: string): Promise<UserActivity> {
    const query = `
        SELECT type, updated_at
        FROM user_activities
        WHERE user_id = $1
      `;

    const result = await this.pool
      .query<{ type: RequestKind; updated_at: Date | null }>(query, [userId])
      .catch(() => ({ rows: [] }));

    const lastSyncDates: UserActivity = {
      WATCHLISTED: null,
      LISTED: null,
      PROGRESS: null,
      HIGH_RATED: null,
    };

    for (const row of result.rows) {
      const updatedAt = row.updated_at ? DateTime.fromJSDate(row.updated_at) : null;
      lastSyncDates[row.type as RequestKind] = updatedAt && updatedAt.isValid ? updatedAt : null;
    }

    return lastSyncDates;
  }
}
