import { TicketOperation, TicketOperationKind } from '@/services/tickets/model';

const IMDB_PATTERN = /tt\d{7,}/;
const URL_PATTERN = /https?:\/\/\S+/;

export enum TicketButtonId {
  Approve = 'ticket-approve',
  Reject = 'ticket-reject',
  Restore = 'ticket-restore',
  Resolve = 'ticket-resolve',
}

export const BUTTON_BY_OPERATION: Partial<Record<TicketOperationKind, TicketButtonId>> = {
  approve: TicketButtonId.Approve,
  reject: TicketButtonId.Reject,
  restore: TicketButtonId.Restore,
  resolveManually: TicketButtonId.Resolve,
};

/**
 * Free-form admin text → operation, constrained to what the ticket accepts.
 * A URL wins when links are accepted (a grab link may carry a tt... in its query params);
 * otherwise a bare IMDb id is looked for.
 */
export function parseMessageOperation(content: string, allowed: TicketOperationKind[]): TicketOperation | null {
  const urlMatch = content.match(URL_PATTERN);
  if (allowed.includes('submitLink') && urlMatch && !urlMatch[0].includes('imdb.com')) {
    return { kind: 'submitLink', url: urlMatch[0] };
  }

  const imdbMatch = content.match(IMDB_PATTERN);
  if (allowed.includes('submitImdb') && imdbMatch) {
    return { kind: 'submitImdb', imdbId: imdbMatch[0] };
  }

  return null;
}

export function parseButtonOperation(customId: string): TicketOperation | null {
  switch (customId) {
    case TicketButtonId.Approve:
      return { kind: 'approve' };
    case TicketButtonId.Reject:
      return { kind: 'reject' };
    case TicketButtonId.Restore:
      return { kind: 'restore' };
    case TicketButtonId.Resolve:
      return { kind: 'resolveManually', note: 'Résolu via Discord' };
    default:
      return null;
  }
}

/** Spontaneous (non-reply) admin message → the URL that opens a manual-download ticket. */
export function parseSpontaneousUrl(content: string): string | null {
  const match = content.match(URL_PATTERN);
  return match ? match[0] : null;
}
