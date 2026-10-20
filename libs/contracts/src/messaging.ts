import { MediaType } from './media';
import { ShowcaseItem } from './player';

/** A subscriber as a channel sees them: `address` is the channel's own (an email address…). */
export type Recipient = {
  name: string;
  address: string;
};

/** Only final outcomes reach users: intermediate statuses oscillate by design. */
export type RequestOutcome = 'fulfilled' | 'rejected';

/** One media whose request reached an outcome, already worded for users (French title first). */
export type RequestNotice = {
  title: string;
  year: number | null;
  type: `${MediaType}`;
  seasonNumber: number | null;
  episodeNumber: number | null;
  outcome: RequestOutcome;
  posterUrl: string | null;
};

/** Everything a newly approved subscriber needs to start. */
export type Welcome = {
  password: string;
  userGuideUrl: string;
  /** Where the user links their catalog account so their requests are picked up. */
  catalogLinkUrl: string;
  showcase: { movies: ShowcaseItem[]; shows: ShowcaseItem[] };
};

/** The catalog refused to renew a subscriber's link: they must authorize it again. */
export type CatalogRelink = {
  catalogName: string;
  linkUrl: string;
};

/** Fixed facts every channel words its messages with. */
export type ServiceIdentity = {
  serviceName: string;
  /** Where subscribers watch (the player's url). */
  playerUrl: string;
  /** Where subscribers follow their own requests. */
  userSpaceUrl: string;
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
 * A way to reach subscribers. Each user picks one channel (`users.messaging_key` = `kind`);
 * the engine batches and deduplicates request notices, the channel only renders and sends.
 * Every method throws when the message could not be sent.
 */
export interface UserChannel {
  readonly kind: string;
  /** Checks the channel can send (credentials, connection); throws when it cannot. */
  verify?(): Promise<void>;
  error(to: Recipient, message: string): Promise<void>;
  welcome(to: Recipient, welcome: Welcome): Promise<void>;
  requestsUpdated(to: Recipient, notices: RequestNotice[]): Promise<void>;
  loginChallenge(to: Recipient, challenge: LoginChallenge): Promise<void>;
  announce(to: Recipient, notice: ServiceNotice): Promise<void>;
  catalogRelink(to: Recipient, relink: CatalogRelink): Promise<void>;
}
