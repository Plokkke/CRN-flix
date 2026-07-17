import { Pool } from 'pg';

import { RequestStatus } from '@/services/database/requests';

export class UserNotificationsRepository {
  constructor(private readonly pool: Pool) {}

  /**
   * Records that a notification is being sent; returns false when the same
   * (user, media, status) notification was already sent, so callers can skip it.
   */
  async claim(userId: string, mediaId: string, status: RequestStatus): Promise<boolean> {
    const query = `
      INSERT INTO user_notifications (user_id, media_id, status)
      VALUES ($1, $2, $3)
      ON CONFLICT (user_id, media_id, status) DO NOTHING
    `;
    const result = await this.pool.query(query, [userId, mediaId, status]);
    return (result.rowCount ?? 0) > 0;
  }
}
