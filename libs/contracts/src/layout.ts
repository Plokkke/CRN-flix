import { MediaType } from './media';

/** The identity a file is filed under; `episodeNumberEnd` covers multi-episode files. */
export type LibraryIdentity = {
  imdbId: string | null;
  type: `${MediaType}`;
  title: string;
  year: number | null;
  seasonNumber: number | null;
  episodeNumber: number | null;
  episodeNumberEnd: number | null;
};

export type LibrarySection = 'movies' | 'series';

/** Where a file belongs, relative to the section root the engine chooses (shared or private). */
export type LibraryPlacement = {
  section: LibrarySection;
  folders: string[];
  /** Without extension: the engine keeps the source file's one. */
  fileName: string;
};

/**
 * The naming and organisation rules of a library, usually the conventions of the player
 * that scans it. Pure: the engine moves the files on the volume it shares with the downloader.
 */
export interface LibraryLayout {
  readonly name: string;
  place(identity: LibraryIdentity): LibraryPlacement;
}
