/** Download metadata key carrying the ticket that launched the download. */
export const TICKET_ID_METADATA_KEY = 'crn-flix-ticket-id';

export enum TicketCategory {
  UserApproval = 'user-approval',
  DownloadAction = 'download-action',
  IdentificationFailure = 'identification-failure',
  /** Dead-letter: no automated recovery, manual resolution only. */
  PipelineFailure = 'pipeline-failure',
  ManualDownload = 'manual-download',
  MissingImdb = 'missing-imdb',
}

export enum TicketStatus {
  Open = 'open',
  Resolved = 'resolved',
  Abandoned = 'abandoned',
}

export enum TicketEventKind {
  Created = 'created',
  AdminMessage = 'admin-message',
  Operation = 'operation',
  AttemptFailed = 'attempt-failed',
  Resolved = 'resolved',
  Abandoned = 'abandoned',
  Note = 'note',
}

export type TicketSubject = {
  type: 'user' | 'planned_download' | 'download_job' | 'show' | 'media';
  id: string;
} | null;

export type TicketPayloadMap = {
  [TicketCategory.UserApproval]: { userId: string };
  [TicketCategory.DownloadAction]: { actionId: string };
  [TicketCategory.IdentificationFailure]: {
    jobId: string;
    packageName: string;
    failedFiles: string[];
    errorMessage: string;
  };
  [TicketCategory.PipelineFailure]: { jobId: string; fileNames: string; failedStep: string; errorMessage: string };
  [TicketCategory.ManualDownload]: {
    url: string;
    imdbId?: string;
    /** Request the finished download must be filed under; corrected in place while Fetchr is still downloading. */
    requestId?: string;
    jobId?: string;
    lastError?: string;
  };
  [TicketCategory.MissingImdb]: { title: string; year: number | null; kind: 'movie' | 'show'; mediaIds: string[] };
};

export type TicketEntity<C extends TicketCategory = TicketCategory> = {
  id: string;
  category: C;
  subjectType: string | null;
  subjectId: string | null;
  status: TicketStatus;
  title: string;
  summary: string | null;
  payload: TicketPayloadMap[C];
  attempts: number;
  resolution: string | null;
  createdAt: Date;
  updatedAt: Date;
  resolvedAt: Date | null;
};

export type TicketEventEntity = {
  id: string;
  ticketId: string;
  kind: TicketEventKind;
  actor: string;
  message: string;
  data: Record<string, unknown>;
  createdAt: Date;
};

export type TicketOperation =
  | { kind: 'submitImdb'; imdbId: string }
  | { kind: 'submitLink'; url: string }
  | { kind: 'approve' }
  | { kind: 'reject' }
  | { kind: 'restore' }
  | { kind: 'resolveManually'; note: string };

export type TicketOperationKind = TicketOperation['kind'];

/** Which operations each category accepts — single source for every adapter. */
export const OPERATIONS_BY_CATEGORY: Record<TicketCategory, TicketOperationKind[]> = {
  [TicketCategory.UserApproval]: ['approve', 'reject'],
  [TicketCategory.DownloadAction]: ['submitLink', 'reject', 'restore', 'resolveManually'],
  [TicketCategory.IdentificationFailure]: ['submitImdb', 'resolveManually'],
  [TicketCategory.PipelineFailure]: ['resolveManually'],
  [TicketCategory.ManualDownload]: ['submitImdb', 'submitLink', 'resolveManually'],
  [TicketCategory.MissingImdb]: ['submitImdb', 'resolveManually'],
};

export type OperationOutcome =
  | { status: 'resolved'; message: string }
  /** Something started (e.g. a download); the ticket stays open until an external fact resolves it. */
  | { status: 'progress'; message: string; payloadPatch?: Record<string, unknown> }
  | { status: 'failed'; message: string; payloadPatch?: Record<string, unknown> };

export type TicketCategoryHandler<C extends TicketCategory = TicketCategory> = (
  ticket: TicketEntity<C>,
  operation: TicketOperation,
  actor: string,
) => Promise<OperationOutcome>;

export type TicketTone = 'danger' | 'warning' | 'info' | 'muted' | 'success';

export type TicketView = {
  title: string;
  tone: TicketTone;
  fields: { name: string; value: string }[];
  footer: string | null;
  operations: TicketOperationKind[];
};

const DEAD_LETTER_ATTEMPTS = 3;

/** Dead-letter: no automated recovery left, a human has to step in. */
export const isDeadLetter = (ticket: TicketEntity): boolean =>
  ticket.category === TicketCategory.PipelineFailure || ticket.attempts >= DEAD_LETTER_ATTEMPTS;
