import { Pool } from 'pg';

import { ServiceNotice } from '@/services/messaging/user';

/** What one recipient got: stored once every recipient was tried. */
export type AnnouncementOutcome = { userId: string; userName: string; outcome: 'sent' | 'failed'; error?: string };

export type ScheduledAnnouncementEntity = {
  id: string;
  notice: ServiceNotice;
  userIds: string[];
  sendAt: Date;
  sentAt: Date | null;
  cancelledAt: Date | null;
  outcomes: AnnouncementOutcome[] | null;
  createdBy: string;
  createdAt: Date;
};

type ScheduledAnnouncementRecord = {
  id: string;
  subject: string;
  title: string;
  tone: ServiceNotice['tone'];
  paragraphs: string[];
  cta: ServiceNotice['cta'] | null;
  user_ids: string[];
  send_at: Date;
  sent_at: Date | null;
  cancelled_at: Date | null;
  outcomes: AnnouncementOutcome[] | null;
  created_by: string;
  created_at: Date;
};

const fromRecord = (row: ScheduledAnnouncementRecord): ScheduledAnnouncementEntity => ({
  id: row.id,
  notice: {
    subject: row.subject,
    title: row.title,
    tone: row.tone,
    paragraphs: row.paragraphs,
    ...(row.cta ? { cta: row.cta } : {}),
  },
  userIds: row.user_ids,
  sendAt: row.send_at,
  sentAt: row.sent_at,
  cancelledAt: row.cancelled_at,
  outcomes: row.outcomes,
  createdBy: row.created_by,
  createdAt: row.created_at,
});

export class ScheduledAnnouncementsRepository {
  constructor(private readonly pool: Pool) {}

  async create(notice: ServiceNotice, userIds: string[], sendAt: Date, createdBy: string): Promise<void> {
    await this.pool.query(
      `INSERT INTO scheduled_announcements (subject, title, tone, paragraphs, cta, user_ids, send_at, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        notice.subject,
        notice.title,
        notice.tone,
        JSON.stringify(notice.paragraphs),
        notice.cta ? JSON.stringify(notice.cta) : null,
        userIds,
        sendAt,
        createdBy,
      ],
    );
  }

  async listUpcoming(): Promise<ScheduledAnnouncementEntity[]> {
    const { rows } = await this.pool.query<ScheduledAnnouncementRecord>(
      `SELECT * FROM scheduled_announcements WHERE sent_at IS NULL AND cancelled_at IS NULL ORDER BY send_at`,
    );
    return rows.map(fromRecord);
  }

  async listRecentlySent(limit: number): Promise<ScheduledAnnouncementEntity[]> {
    const { rows } = await this.pool.query<ScheduledAnnouncementRecord>(
      `SELECT * FROM scheduled_announcements WHERE sent_at IS NOT NULL ORDER BY sent_at DESC LIMIT $1`,
      [limit],
    );
    return rows.map(fromRecord);
  }

  /** Marks the due ones as being sent in one statement: an announcement is never sent twice. */
  async claimDue(now: Date): Promise<ScheduledAnnouncementEntity[]> {
    const { rows } = await this.pool.query<ScheduledAnnouncementRecord>(
      `UPDATE scheduled_announcements SET sent_at = $1
       WHERE sent_at IS NULL AND cancelled_at IS NULL AND send_at <= $1
       RETURNING *`,
      [now],
    );
    return rows.map(fromRecord);
  }

  async recordOutcomes(id: string, outcomes: AnnouncementOutcome[]): Promise<void> {
    await this.pool.query(`UPDATE scheduled_announcements SET outcomes = $2 WHERE id = $1`, [
      id,
      JSON.stringify(outcomes),
    ]);
  }

  /** False when it already started or was cancelled. */
  async cancel(id: string, now: Date): Promise<boolean> {
    const { rowCount } = await this.pool.query(
      `UPDATE scheduled_announcements SET cancelled_at = $2 WHERE id = $1 AND sent_at IS NULL AND cancelled_at IS NULL`,
      [id, now],
    );
    return (rowCount ?? 0) > 0;
  }
}
