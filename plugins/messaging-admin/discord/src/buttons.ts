import { TicketOperation, TicketOperationKind } from '@crn-flix/contracts';

export enum TicketButtonId {
  Approve = 'ticket-approve',
  Reject = 'ticket-reject',
  Restore = 'ticket-restore',
  Resolve = 'ticket-resolve',
}

/** Only button-shaped operations get a button; imdb/link submissions are replies. */
export const BUTTON_BY_OPERATION: Partial<Record<TicketOperationKind, TicketButtonId>> = {
  approve: TicketButtonId.Approve,
  reject: TicketButtonId.Reject,
  restore: TicketButtonId.Restore,
  resolveManually: TicketButtonId.Resolve,
};

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
