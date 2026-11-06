import { LibrarySection } from './layout';
import { MediaItem } from './media';

/** A media the player can serve right now; for an episode, `imdbId` is the show's. */
export type PlayerAsset = MediaItem;

/** Thrown by `upsertAccount` when the player refuses to create an account under this name. */
export class AccountNameTakenError extends Error {
  constructor(readonly userName: string) {
    super(`Account name "${userName}" is already taken`);
    this.name = 'AccountNameTakenError';
  }
}

/** A library the engine wants served: one folder (as the player sees it), one kind of content. */
export type PlayerLibrary = {
  name: string;
  section: LibrarySection;
  path: string;
};

/** What the engine decides for a viewing account; every absent field leaves the account's own. */
export type AccountPolicy = {
  /** 0 means unlimited. */
  maxStreams?: number;
  /**
   * The libraries the account sees, by folder. Only libraries under `managedRoot` are the
   * engine's: the others keep being visible to everyone.
   */
  libraries?: { paths: string[]; managedRoot: string };
  /** Highest parental rating the account may play, on the player's scale; null lifts the limit. */
  maxParentalRating?: number | null;
};

export type ShowcaseKind = 'movie' | 'show' | 'episode';

/** A library entry to show off to users (welcome email), with its artwork. */
export type ShowcaseItem = {
  title: string;
  imdbId: string;
  type: ShowcaseKind;
  posterUrl: string;
};

/**
 * Where users watch: tells the engine what is available (which fulfils requests)
 * and holds the users' viewing accounts. `url` is the address users open.
 */
export interface Player {
  readonly name: string;
  readonly url: string;
  /** Every asset whose media identity is known (imdb id resolved). */
  listAvailable(): Promise<PlayerAsset[]>;
  refreshLibrary(): Promise<void>;
  /** Creates the libraries the player does not serve yet (matched by folder); returns how many were created. */
  ensureLibraries(libraries: PlayerLibrary[]): Promise<number>;
  /**
   * Gives the user an account with this password: resets it when `accountId` is known,
   * otherwise adopts an account of the same name or creates one. Returns the account id.
   */
  upsertAccount(userName: string, password: string, accountId: string | null): Promise<string>;
  /** Every viewing account, including those the engine did not create. */
  listAccountIds(): Promise<string[]>;
  /** The account's current stream limit, null when the player's own administrators manage it. */
  accountMaxStreams(accountId: string): Promise<number | null>;
  /** Applies the service's viewing rules to the account; false when nothing had to change. */
  applyAccountPolicy(accountId: string, policy: AccountPolicy): Promise<boolean>;
  showcase(kind: ShowcaseKind, count: number): Promise<ShowcaseItem[]>;
}
