import * as path from 'path';

import { z } from 'zod';

import { LibrarySection } from '@crn-flix/contracts';

export const SECTIONS: LibrarySection[] = ['movies', 'series'];

/** Files live in the store; every player library is a shelf of links to them. */
export const libraryConfigSchema = z.object({
  mediasPath: z.string(),
  moviesFolder: z.string(),
  seriesFolder: z.string(),
  /** Where the player sees `mediasPath`. */
  playerRoot: z.string(),
  /** The player's parental limit on kids accounts (a safety net under the kids shelf's rules). */
  kidsMaxParentalRating: z.number().int().min(0),
  /** The admin's own account (`users.name`): their collection takes the manual downloads kept for themselves. */
  adminUserName: z.string().nullable(),
});

export type LibraryConfig = z.infer<typeof libraryConfigSchema>;

/** The standard shelf keeps the historical section folders, so the player sees the very same paths. */
export const STANDARD_SHELF = 'standard';
const STORE_FOLDER = 'store';
const SHELVES_FOLDER = 'shelves';
const PERSONAL_FOLDER = 'users';

/** Where everything lives on the volume the engine shares with the downloader and the player. */
export class LibraryPaths {
  constructor(private readonly config: LibraryConfig) {}

  private sectionFolder(section: LibrarySection): string {
    return section === 'series' ? this.config.seriesFolder : this.config.moviesFolder;
  }

  store(section: LibrarySection): string {
    return path.join(this.config.mediasPath, STORE_FOLDER, this.sectionFolder(section));
  }

  shelf(key: string, section: LibrarySection): string {
    return key === STANDARD_SHELF
      ? path.join(this.config.mediasPath, this.sectionFolder(section))
      : path.join(this.config.mediasPath, SHELVES_FOLDER, key, this.sectionFolder(section));
  }

  personalRoot(): string {
    return path.join(this.config.mediasPath, SHELVES_FOLDER, PERSONAL_FOLDER);
  }

  personal(userId: string, section: LibrarySection): string {
    return path.join(this.personalRoot(), userId, this.sectionFolder(section));
  }

  /** The same place as the player sees it. */
  forPlayer(enginePath: string): string {
    return path.join(this.config.playerRoot, path.relative(this.config.mediasPath, enginePath));
  }
}
