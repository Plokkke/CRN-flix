/** A subscriber as a channel sees them: `address` is the channel's own (email, Discord id…). */
export type Recipient = {
  name: string;
  address: string;
};

export type RequestOutcome = 'fulfilled' | 'rejected';

/** One media whose request reached an outcome, already worded for users. */
export type RequestNotice = {
  title: string;
  seasonNumber: number | null;
  episodeNumber: number | null;
  outcome: RequestOutcome;
  /** Why it was rejected, when it was. */
  reason: string | null;
  posterUrl: string | null;
};

/** Proofs of a subscriber-space login: a code to type and a magic link, both single-use. */
export type LoginChallenge = {
  code: string;
  link: string;
  serviceName: string;
  expiresInMinutes: number;
};

export const NOTICE_TONES = ['warning', 'success', 'info'] as const;
export type NoticeTone = (typeof NOTICE_TONES)[number];

/** A one-off announcement to subscribers (outage, restoration…). */
export type ServiceNotice = {
  subject: string;
  title: string;
  paragraphs: string[];
  tone: NoticeTone;
  cta?: { label: string; url: string };
};

/**
 * DRAFT — not wired yet. A way to reach subscribers. Each user picks one channel;
 * the engine batches and deduplicates, the channel only renders and sends.
 */
export interface UserChannel {
  readonly kind: string;
  accepts(address: string): boolean;
  requestsUpdated(to: Recipient, notices: RequestNotice[]): Promise<void>;
  registered(to: Recipient, playerUrl: string, password: string): Promise<void>;
  loginChallenge(to: Recipient, challenge: LoginChallenge): Promise<void>;
  announce(to: Recipient, notice: ServiceNotice): Promise<void>;
}
