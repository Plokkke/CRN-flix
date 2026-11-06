import { TicketOperation, TicketOperationKind } from '@crn-flix/contracts';

export enum TicketButtonId {
  Approve = 'ticket-approve',
  ApproveAdult = 'ticket-approve-adult',
  ApproveKids = 'ticket-approve-kids',
  Reject = 'ticket-reject',
  Restore = 'ticket-restore',
  Resolve = 'ticket-resolve',
  GrantExemption = 'ticket-grant-exemption',
  ExcludeTitle = 'ticket-exclude-title',
  ShelveStandard = 'ticket-shelve-standard',
  ShelveKids = 'ticket-shelve-kids',
  ShelvePersonal = 'ticket-shelve-personal',
}

/** Only button-shaped operations get a button; imdb/link submissions are replies. */
export const BUTTON_BY_OPERATION: Partial<Record<TicketOperationKind, TicketButtonId>> = {
  approve: TicketButtonId.Approve,
  approveAdult: TicketButtonId.ApproveAdult,
  approveKids: TicketButtonId.ApproveKids,
  reject: TicketButtonId.Reject,
  restore: TicketButtonId.Restore,
  resolveManually: TicketButtonId.Resolve,
  grantExemption: TicketButtonId.GrantExemption,
  excludeTitle: TicketButtonId.ExcludeTitle,
  shelveStandard: TicketButtonId.ShelveStandard,
  shelveKids: TicketButtonId.ShelveKids,
  shelvePersonal: TicketButtonId.ShelvePersonal,
};

export function parseButtonOperation(customId: string): TicketOperation | null {
  switch (customId) {
    case TicketButtonId.Approve:
      return { kind: 'approve' };
    case TicketButtonId.ApproveAdult:
      return { kind: 'approveAdult' };
    case TicketButtonId.ApproveKids:
      return { kind: 'approveKids' };
    case TicketButtonId.Reject:
      return { kind: 'reject' };
    case TicketButtonId.Restore:
      return { kind: 'restore' };
    case TicketButtonId.GrantExemption:
      return { kind: 'grantExemption' };
    case TicketButtonId.ExcludeTitle:
      return { kind: 'excludeTitle' };
    case TicketButtonId.ShelveStandard:
      return { kind: 'shelveStandard' };
    case TicketButtonId.ShelveKids:
      return { kind: 'shelveKids' };
    case TicketButtonId.ShelvePersonal:
      return { kind: 'shelvePersonal' };
    case TicketButtonId.Resolve:
      return { kind: 'resolveManually', note: 'Résolu via Discord' };
    default:
      return null;
  }
}
