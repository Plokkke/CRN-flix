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
 * A user's account on a catalog, as an account source hands it over.
 * `credentials` is opaque to the engine: only the catalog that issued it reads it.
 */
export type CatalogAccount = {
  userRef: string;
  credentials: unknown;
};

/** Where catalog accounts come from (today: tokens stored by the player's Trakt plugin). */
export interface CatalogAccountSource {
  listAccounts(): Promise<CatalogAccount[]>;
}

export type ShowPlayhead = {
  imdbId: string;
  playhead: Playhead | null;
};

/**
 * DRAFT — not wired yet. A catalog is where users reference what they want.
 * It returns the **full intent** (every episode, never truncated to a window);
 * the engine owns persistence, deduplication and planning.
 */
export interface Catalog {
  readonly name: string;
  readonly reasons: readonly RequestReason[];
  listRequests(account: CatalogAccount, reason: RequestReason): Promise<MediaItem[]>;
  listPlayheads(account: CatalogAccount): Promise<ShowPlayhead[]>;
  /** A link to the media on the catalog, for humans. */
  mediaUrl(media: Pick<MediaItem, 'imdbId' | 'type'>): string | null;
}
