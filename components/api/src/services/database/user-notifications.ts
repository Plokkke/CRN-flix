import { Pool } from 'pg';

import { RequestStatus } from '@/services/database/requests';

/** One notification: a user told that a media reached a status. */
export type NotificationKey = {
  userId: string;
  mediaId: string;
  status: RequestStatus;
};

/**
 * Outbox of user notifications: at most one per (user, media, status), queued unsent and
 * marked sent only once a channel delivered it, so nothing is lost on a failed send or a restart.
 */
export class UserNotificationsRepository {
  constructor(private readonly pool: Pool) {}

  async wasSent({ userId, mediaId, status }: NotificationKey): Promise<boolean> {
    const { rowCount } = await this.pool.query(
      `SELECT 1 FROM user_notifications
       WHERE user_id = $1 AND media_id = $2 AND status = $3 AND sent_at IS NOT NULL`,
      [userId, mediaId, status],
    );
    return (rowCount ?? 0) > 0;
  }

  /** Idempotent: an already queued (or sent) notification is left as is. */
  async queue({ userId, mediaId, status }: NotificationKey): Promise<void> {
    await this.pool.query(
      `INSERT INTO user_notifications (user_id, media_id, status)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id, media_id, status) DO NOTHING`,
      [userId, mediaId, status],
    );
  }

  async markSent(keys: NotificationKey[]): Promise<void> {
    if (keys.length === 0) {
      return;
    }
    await this.pool.query(
      `UPDATE user_notifications n SET sent_at = CURRENT_TIMESTAMP
       FROM unnest($1::uuid[], $2::uuid[], $3::varchar[]) AS k(user_id, media_id, status)
       WHERE n.user_id = k.user_id AND n.media_id = k.media_id AND n.status = k.status AND n.sent_at IS NULL`,
      [keys.map((k) => k.userId), keys.map((k) => k.mediaId), keys.map((k) => k.status)],
    );
  }

  /** Unsent notifications queued before `queuedBefore` (younger ones may still be in a batch). */
  async listPending(queuedBefore: Date, limit: number): Promise<NotificationKey[]> {
    const { rows } = await this.pool.query<{ user_id: string; media_id: string; status: RequestStatus }>(
      `SELECT user_id, media_id, status FROM user_notifications
       WHERE sent_at IS NULL AND queued_at < $1
       ORDER BY queued_at
       LIMIT $2`,
      [queuedBefore, limit],
    );
    return rows.map((row) => ({ userId: row.user_id, mediaId: row.media_id, status: row.status }));
  }

  /** For a notification that no longer applies (the request moved on). */
  async discard({ userId, mediaId, status }: NotificationKey): Promise<void> {
    await this.pool.query(
      `DELETE FROM user_notifications WHERE user_id = $1 AND media_id = $2 AND status = $3 AND sent_at IS NULL`,
      [userId, mediaId, status],
    );
  }
}
