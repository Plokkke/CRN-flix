import { MediaType } from './media';

/** The identity a stored file is filed under; `episodeNumberEnd` covers multi-episode files. */
export type StoredMediaIdentity = {
  imdbId: string;
  type: MediaType;
  title: string;
  year: number | null;
  seasonNumber: number | null;
  episodeNumber: number | null;
  episodeNumberEnd: number | null;
};

export type StoreOptions = {
  /** Kept out of the shared library (a private request). */
  private?: boolean;
};

export type StoredFile = {
  path: string;
};

/**
 * DRAFT — not wired yet. Where finished downloads land and how they are named,
 * so the player can pick them up. Naming rules belong to the storage, not the engine.
 */
export interface Storage {
  readonly name: string;
  store(sourcePath: string, identity: StoredMediaIdentity, options?: StoreOptions): Promise<StoredFile>;
}
