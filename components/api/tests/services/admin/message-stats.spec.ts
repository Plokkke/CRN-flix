import { buildMessageStats, FLOOD_THRESHOLD_24H } from '@/services/admin/message-stats';
import { UserMessageCount } from '@/services/database/user-messages';

const count = (overrides: Partial<UserMessageCount>): UserMessageCount => ({
  userId: 'u1',
  userName: 'Zoé',
  kind: 'requests-updated',
  last24h: 1,
  last7d: 2,
  total: 3,
  lastSentAt: new Date('2026-10-20T10:00:00Z'),
  ...overrides,
});

describe('buildMessageStats', () => {
  it('folds the counts into one row per user and one cell per kind', () => {
    const [row] = buildMessageStats([count({}), count({ kind: 'welcome', last24h: 0, last7d: 0, total: 1 })]);

    expect(row.userName).toBe('Zoé');
    expect(row.cells['requests-updated']).toMatchObject({ last24h: 1, last7d: 2, total: 3, flagged: false });
    expect(row.cells.welcome).toMatchObject({ total: 1 });
    expect(row.cells.login).toBeNull();
  });

  it('flags a user flooded with one kind within 24 h and lists them first', () => {
    const rows = buildMessageStats([
      count({ userId: 'u1', userName: 'Albert' }),
      count({ userId: 'u2', userName: 'Zoé', kind: 'login', last24h: FLOOD_THRESHOLD_24H + 1 }),
    ]);

    expect(rows.map((row) => [row.userName, row.flagged])).toEqual([
      ['Zoé', true],
      ['Albert', false],
    ]);
    expect(rows[0].cells.login?.flagged).toBe(true);
  });

  it('does not flag a user exactly at the threshold', () => {
    const [row] = buildMessageStats([count({ last24h: FLOOD_THRESHOLD_24H })]);

    expect(row.flagged).toBe(false);
  });
});
