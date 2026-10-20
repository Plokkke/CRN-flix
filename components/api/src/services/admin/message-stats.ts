import { USER_MESSAGE_KINDS, UserMessageCount, UserMessageKind } from '@/services/database/user-messages';

/** More messages than this of one kind to one user within 24 h is flagged: something is looping. */
export const FLOOD_THRESHOLD_24H = 5;

export type MessageStatsCell = Omit<UserMessageCount, 'userId' | 'userName' | 'kind'> & { flagged: boolean };

export type MessageStatsRow = {
  userName: string;
  cells: Record<UserMessageKind, MessageStatsCell | null>;
  flagged: boolean;
};

const emptyCells = (): Record<UserMessageKind, MessageStatsCell | null> =>
  Object.fromEntries(USER_MESSAGE_KINDS.map((kind) => [kind, null])) as Record<
    UserMessageKind,
    MessageStatsCell | null
  >;

/** One row per user, one cell per kind; flagged users first, then by name. */
export function buildMessageStats(counts: UserMessageCount[]): MessageStatsRow[] {
  const rows = new Map<string, MessageStatsRow>();
  for (const { userId, userName, kind, ...count } of counts) {
    const row = rows.get(userId) ?? { userName, cells: emptyCells(), flagged: false };
    const flagged = count.last24h > FLOOD_THRESHOLD_24H;
    row.cells[kind] = { ...count, flagged };
    row.flagged ||= flagged;
    rows.set(userId, row);
  }
  return [...rows.values()].sort(
    (a, b) =>
      Number(b.flagged) - Number(a.flagged) || a.userName.localeCompare(b.userName, 'fr', { sensitivity: 'base' }),
  );
}
