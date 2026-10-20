/** What an admin can do on a ticket; which ones a ticket accepts is part of its view. */
export type TicketOperation =
  | { kind: 'submitImdb'; imdbId: string }
  | { kind: 'submitLink'; url: string }
  | { kind: 'approve' }
  | { kind: 'reject' }
  | { kind: 'restore' }
  | { kind: 'resolveManually'; note: string };

export type TicketOperationKind = TicketOperation['kind'];

export const OPERATION_LABELS: Record<TicketOperationKind, string> = {
  approve: 'Accepter',
  reject: 'Rejeter',
  restore: 'Restaurer',
  submitImdb: 'Soumettre un IMDb ID',
  submitLink: 'Soumettre un lien',
  resolveManually: 'Marquer résolu',
};

export type TicketTone = 'danger' | 'warning' | 'info' | 'muted' | 'success';

/** A ticket as every admin surface shows it (built once by the engine). */
export type TicketView = {
  title: string;
  tone: TicketTone;
  fields: { name: string; value: string }[];
  footer: string | null;
  operations: TicketOperationKind[];
};

export enum TicketEventKind {
  Created = 'created',
  AdminMessage = 'admin-message',
  Operation = 'operation',
  AttemptFailed = 'attempt-failed',
  Resolved = 'resolved',
  Abandoned = 'abandoned',
  Note = 'note',
}

/** One line of a ticket's timeline; `actor` is `system` or `<surface>:<admin id>`. */
export type TicketTimelineEntry = {
  kind: TicketEventKind;
  message: string;
  actor: string;
};

/** The live downloads, already worded and ordered for display. */
export type DownloadsBoardView = {
  active: number;
  entries: { label: string; status: string }[];
  /** Entries left out for room. */
  hidden: number;
};

/** An admin's message as the channel received it. */
export type AdminMessage = {
  /** The message itself, to acknowledge it. */
  ref: string;
  /** The ticket it answers (the root ref it replies to or whose conversation it is in), if any. */
  ticketRef: string | null;
  /** Posted inside a conversation rather than in the channel itself. */
  inConversation: boolean;
  adminId: string;
  content: string;
};

export type AdminAcknowledgement = 'succeeded' | 'failed' | null;

/** What the engine answers to an admin, implemented by the engine and handed to the channel. */
export interface AdminInbox {
  /** Returns how to acknowledge the message (null: nothing to acknowledge). */
  message(message: AdminMessage): Promise<AdminAcknowledgement>;
  /** An operation triggered from a ticket's controls; returns its refreshed view, null once closed. */
  operation(ticketRef: string, operation: TicketOperation, adminId: string): Promise<TicketView | null>;
}

export type PurgeReport = { removed: number; kept: number };

/**
 * Where admins are summoned: tickets show up there, admins answer there. The engine owns
 * tickets and their bindings (`<channel name>` adapter refs); the channel only renders,
 * listens and reports. Only messages from `adminIds` reach the inbox.
 */
export interface AdminChannel {
  readonly name: string;
  readonly adminIds: readonly string[];
  start(inbox: AdminInbox): void;
  stop(): void;
  /** Shows a ticket and opens its conversation; returns its root ref. */
  postTicket(view: TicketView): Promise<string>;
  /** Opens the conversation on a message an admin posted on their own (e.g. a manual link). */
  adoptMessage(ref: string, title: string): Promise<void>;
  updateTicket(rootRef: string, view: TicketView): Promise<void>;
  appendToTicket(rootRef: string, entry: TicketTimelineEntry): Promise<void>;
  /** Removes the conversation, and the root too unless it is an admin's own message. */
  closeTicket(rootRef: string): Promise<void>;
  acknowledge(ref: string, outcome: Exclude<AdminAcknowledgement, null>): Promise<void>;
  showDownloads(board: DownloadsBoardView): Promise<void>;
  /** Wipes the channel down to what it pinned itself; every root ref is lost. */
  purge(): Promise<PurgeReport>;
  notifyAdmin(adminId: string, text: string): Promise<void>;
}
