import { MediaItem, Playhead } from './media';

/**
 * Why a user wants a media. A catalog maps its own signals onto these:
 * a watchlist, a show being watched, a rating high enough to keep it.
 */
export enum RequestReason {
  Watchlisted = 'WATCHLISTED',
  Progress = 'PROGRESS',
  HighRated = 'HIGH_RATED',
}

/**
 * Catalog credentials as an account source stores them, tied to the user's player account.
 * `credentials` is opaque to the engine: only the catalog that issued them reads them.
 */
export type LinkedCatalogAccount = {
  playerAccountId: string;
  credentials: unknown;
};

/** Where catalog credentials live (today: the player's Trakt plugin configuration). */
export interface CatalogAccountSource {
  listAccounts(): Promise<LinkedCatalogAccount[]>;
  /** Stores credentials a catalog renewed, so every holder of the account keeps working. */
  saveCredentials(playerAccountId: string, credentials: unknown): Promise<void>;
  /** Puts every linked account back on the service's catalog settings; returns how many changed. */
  enforceSettings(): Promise<number>;
}

/** The catalog refused to renew an account's credentials: only the user can link it again. */
export class CatalogAccountRevokedError extends Error {
  constructor(reason: string) {
    super(`Catalog account must be linked again: ${reason}`);
    this.name = 'CatalogAccountRevokedError';
  }
}

/** An account as the engine hands it to a catalog: `userRef` is the engine's stable user id. */
export type CatalogAccount = {
  userRef: string;
  credentials: unknown;
};

/** A requested media; `catalogSlug` lets humans be linked back to the catalog's page. */
export type CatalogItem = MediaItem & {
  catalogSlug: string | null;
};

/** When each reason last changed on the catalog side; a reason left out is always re-read. */
export type CatalogActivity = Partial<Record<RequestReason, Date | null>>;

/**
 * Where users reference what they want. A catalog returns the **full intent**
 * (every aired episode, never truncated to a window); the engine owns persistence,
 * deduplication, incremental scheduling and planning.
 */
export interface Catalog {
  readonly name: string;
  readonly reasons: readonly RequestReason[];
  lastActivity(account: CatalogAccount): Promise<CatalogActivity>;
  listRequests(account: CatalogAccount, reason: RequestReason): Promise<CatalogItem[]>;
  /** `START_OF_SHOW` when the user never watched it, nulls when completed or dropped. */
  playhead(account: CatalogAccount, showImdbId: string): Promise<Playhead>;
  /**
   * Fresh credentials when the current ones expire soon, null when they are still good;
   * throws `CatalogAccountRevokedError` when the catalog refuses to renew them.
   */
  renewCredentials(credentials: unknown, now: Date): Promise<unknown>;
}
