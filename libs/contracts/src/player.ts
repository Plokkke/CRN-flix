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

/** What the engine decides for a viewing account; `maxStreams` 0 means unlimited. */
export type AccountPolicy = {
  maxStreams: number;
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
  /**
   * Gives the user an account with this password: resets it when `accountId` is known,
   * otherwise adopts an account of the same name or creates one. Returns the account id.
   */
  upsertAccount(userName: string, password: string, accountId: string | null): Promise<string>;
  /** The account's current stream limit, null when the player's own administrators manage it. */
  accountMaxStreams(accountId: string): Promise<number | null>;
  /** Applies the service's viewing rules to the account; false when nothing had to change. */
  applyAccountPolicy(accountId: string, policy: AccountPolicy): Promise<boolean>;
  showcase(kind: ShowcaseKind, count: number): Promise<ShowcaseItem[]>;
}
