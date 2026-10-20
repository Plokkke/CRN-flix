import { MediaType } from './media';

/** A media the player can serve right now. */
export type PlayerAsset = {
  imdbId: string;
  type: MediaType;
  seasonNumber: number | null;
  episodeNumber: number | null;
};

/**
 * DRAFT — not wired yet. Where users watch: tells the engine what is available
 * (which fulfils requests) and holds the users' viewing accounts.
 */
export interface Player {
  readonly name: string;
  readonly url: string;
  listAvailable(): Promise<PlayerAsset[]>;
  refreshLibrary(): Promise<void>;
  /** Creates the account when missing, then sets its password; returns the player's account id. */
  upsertAccount(userName: string, password: string): Promise<string>;
}
