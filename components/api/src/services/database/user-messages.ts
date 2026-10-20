import { Pool } from 'pg';

export const USER_MESSAGE_KINDS = [
  'welcome',
  'login',
  'requests-updated',
  'error',
  'announce',
  'catalog-relink',
] as const;
export type UserMessageKind = (typeof USER_MESSAGE_KINDS)[number];

/** How many messages of one kind a user received, over sliding windows ending at `now`. */
export type UserMessageCount = {
  userId: string;
  userName: string;
  kind: UserMessageKind;
  last24h: number;
  last7d: number;
  total: number;
  lastSentAt: Date;
};

type UserMessageCountRecord = {
  user_id: string;
  user_name: string;
  kind: UserMessageKind;
  last_24h: number;
  last_7d: number;
  total: number;
  last_sent_at: Date;
};

/** Journal of the messages a channel delivered: written only after a successful send. */
export class UserMessagesRepository {
  constructor(private readonly pool: Pool) {}

  async record(userId: string, kind: UserMessageKind, channel: string): Promise<void> {
    await this.pool.query(`INSERT INTO user_messages (user_id, kind, channel) VALUES ($1, $2, $3)`, [
      userId,
      kind,
      channel,
    ]);
  }

  async countPerUserAndKind(now: Date): Promise<UserMessageCount[]> {
    const { rows } = await this.pool.query<UserMessageCountRecord>(
      `SELECT m.user_id, u.name AS user_name, m.kind,
              count(*) FILTER (WHERE m.sent_at > $1::timestamptz - interval '24 hours')::int AS last_24h,
              count(*) FILTER (WHERE m.sent_at > $1::timestamptz - interval '7 days')::int AS last_7d,
              count(*)::int AS total,
              max(m.sent_at) AS last_sent_at
       FROM user_messages m JOIN users u ON u.id = m.user_id
       GROUP BY m.user_id, u.name, m.kind
       ORDER BY u.name, m.kind`,
      [now],
    );
    return rows.map((row) => ({
      userId: row.user_id,
      userName: row.user_name,
      kind: row.kind,
      last24h: row.last_24h,
      last7d: row.last_7d,
      total: row.total,
      lastSentAt: row.last_sent_at,
    }));
  }
}
