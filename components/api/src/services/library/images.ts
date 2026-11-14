import * as fsPromises from 'fs/promises';
import * as path from 'path';

import { LibraryImage, LibrarySection } from '@crn-flix/contracts';

import { assetPath } from '@/services/assets';

/** The artwork of a shelf's libraries, absent when none is bundled. */
export type ShelfImages = {
  of(shelf: string, section: LibrarySection): Promise<LibraryImage | undefined>;
};

export const NO_IMAGES: ShelfImages = { of: async () => undefined };

/** The personal shelves all share one picture: the library's name already says whose it is. */
export const PERSONAL_SHELF = 'personal';

/**
 * Bundled pictures in `assets/libraries`, one per shelf and section: `<shelf>-<section>.jpg`.
 * A missing one leaves the player's own picture (a film picture never stands for series).
 * Read once, then kept.
 */
export class BundledShelfImages implements ShelfImages {
  private readonly cache = new Map<string, Promise<LibraryImage | undefined>>();

  constructor(
    private readonly folder: string = assetPath('libraries'),
    private readonly readFile: (file: string) => Promise<Uint8Array> = fsPromises.readFile,
  ) {}

  of(shelf: string, section: LibrarySection): Promise<LibraryImage | undefined> {
    const key = `${shelf}-${section}`;
    if (!this.cache.has(key)) {
      this.cache.set(key, this.load(`${key}.jpg`));
    }
    return this.cache.get(key)!;
  }

  private async load(name: string): Promise<LibraryImage | undefined> {
    const data = await this.readFile(path.join(this.folder, name)).catch(() => null);
    return data ? { data, contentType: 'image/jpeg' } : undefined;
  }
}
