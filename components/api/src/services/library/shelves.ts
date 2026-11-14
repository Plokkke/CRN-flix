import * as fsPromises from 'fs/promises';
import * as path from 'path';

import { Logger } from '@nestjs/common';

import { LibrarySection, Player } from '@crn-flix/contracts';

import { LibraryTitle, LibraryTitlesRepository } from '@/services/database/library';

import { desiredLinks, diffLinks, Link, linkTo, TitleShelves } from './links';
import { LibraryPaths, SECTIONS, STANDARD_SHELF } from './paths';

/** Hidden file kept in every shelf folder (see `keepFolder`); the player ignores dot files. */
export const SHELF_MARKER = '.crn-flix-shelf';
const SHELF_MARKER_TEXT = 'Kept by CRN-Flix: Jellyfin does not clean an empty library folder.\n';

/** Decides where every title of the store is shown. */
export type ShelfResolver = {
  readonly sharedShelves: string[];
  shelvesOf(titles: LibraryTitle[]): Promise<(imdbId: string) => TitleShelves>;
};

/** Keeps titles the rules now restrict on their shared shelf until an admin decides (retroactivity). */
export type ShelfGuard = {
  sweep(): Promise<void>;
  freeze(leaving: { imdbId: string; shelf: string }[]): Promise<Set<string>>;
};

const NO_GUARD: ShelfGuard = { sweep: async () => {}, freeze: async () => new Set() };

/** Until the policy places titles, everything is on the standard shelf, as before the store. */
export const STANDARD_ONLY: ShelfResolver = {
  sharedShelves: [STANDARD_SHELF],
  shelvesOf: async () => () => ({ shared: STANDARD_SHELF, personal: [] }),
};

const IMDB_TAG = /\[imdbid-(tt\d+)\]/;

type Fs = Pick<
  typeof fsPromises,
  'readdir' | 'lstat' | 'readlink' | 'symlink' | 'unlink' | 'mkdir' | 'rename' | 'stat' | 'writeFile' | 'rm'
>;

const describeError = (error: unknown): string => (error instanceof Error ? error.message : String(error));

const isMissing = (error: unknown): boolean => (error as NodeJS.ErrnoException).code === 'ENOENT';

/**
 * Keeps the shelves (the folders the player scans) in line with where each title should be
 * shown: links are created and removed, never a file of the store (except a title an admin
 * takes down, see `discard`). Real folders found in the
 * standard shelf (the library as it was before the store) are adopted: moved to the store and
 * replaced by a link of the same name, so the player keeps seeing the very same paths.
 */
export class LibraryShelves {
  private static readonly logger = new Logger(LibraryShelves.name);

  private running: Promise<void> | null = null;
  private rerun = false;

  constructor(
    private readonly paths: LibraryPaths,
    private readonly titles: LibraryTitlesRepository,
    private readonly resolver: ShelfResolver,
    private readonly player: Player,
    private readonly afterChange: () => Promise<void> = async () => {},
    private readonly guard: ShelfGuard = NO_GUARD,
    private readonly fs: Fs = fsPromises,
  ) {}

  async titlePlaced(title: LibraryTitle): Promise<void> {
    await this.titles.record(title);
    await this.reconcile();
  }

  /**
   * Deletes the title's folders from the store for good (an admin took it down), then the
   * links follow. Only folders the store recorded, by their plain name, are ever removed.
   */
  async discard(imdbId: string): Promise<number> {
    const theirs = (await this.titles.list()).filter((title) => title.imdbId === imdbId);
    for (const title of theirs) {
      if (!title.folder || path.basename(title.folder) !== title.folder || title.folder.startsWith('.')) {
        throw new Error(`Refusing to delete an unexpected store folder: ${title.folder}`);
      }
      await this.fs.rm(path.join(this.paths.store(title.section), title.folder), { recursive: true, force: true });
      await this.titles.remove(title);
    }
    LibraryShelves.logger.log(`Discarded ${imdbId}: ${theirs.length} store folder(s) deleted`);
    await this.reconcile();
    return theirs.length;
  }

  /** Coalesces concurrent requests: one pass at a time, plus one more if asked meanwhile. */
  async reconcile(): Promise<void> {
    if (this.running) {
      this.rerun = true;
      return this.running;
    }
    this.running = this.reconcileUntilSettled().finally(() => (this.running = null));
    return this.running;
  }

  private async reconcileUntilSettled(): Promise<void> {
    do {
      this.rerun = false;
      await this.pass();
    } while (this.rerun);
  }

  /** A title frozen by the guard changes where it goes: the pass starts over once, with it kept. */
  private async pass(mayFreeze = true): Promise<void> {
    await this.guard.sweep();
    const titles = await this.presentTitles();
    const shelvesOf = await this.resolver.shelvesOf(titles);
    const desired = desiredLinks(titles, shelvesOf, this.paths);
    const { create, remove } = diffLinks(desired, await this.actualLinks());
    if (mayFreeze && (await this.freezeLeaving(titles, remove)).size > 0) {
      return this.pass(false);
    }
    if (create.length === 0 && remove.length === 0) {
      return;
    }
    await Promise.all(remove.map((link) => this.removeLink(link)));
    for (const link of create) {
      await this.createLink(link);
    }
    LibraryShelves.logger.log(`Shelves: ${create.length} link(s) created, ${remove.length} removed`);
    await this.player.refreshLibrary().catch((error: unknown) => {
      LibraryShelves.logger.warn(`Player refresh after shelving failed: ${describeError(error)}`);
    });
    await this.afterChange().catch((error: unknown) => {
      LibraryShelves.logger.warn(`After shelving: ${describeError(error)}`);
    });
  }

  /** The titles about to leave a shared shelf, handed to the guard. */
  private async freezeLeaving(titles: LibraryTitle[], remove: Link[]): Promise<Set<string>> {
    const sharedLinks = new Map(
      titles.flatMap((title) =>
        this.resolver.sharedShelves.map(
          (shelf) =>
            [path.join(this.paths.shelf(shelf, title.section), title.folder), { imdbId: title.imdbId, shelf }] as const,
        ),
      ),
    );
    const leaving = remove.flatMap((link) => sharedLinks.get(link.path) ?? []);
    return leaving.length > 0 ? this.guard.freeze(leaving) : new Set();
  }

  /** Titles whose store folder exists: a row written just before a crash must not become a dangling link. */
  private async presentTitles(): Promise<LibraryTitle[]> {
    const titles = await this.titles.list();
    const present = await Promise.all(
      titles.map((title) =>
        this.fs.stat(path.join(this.paths.store(title.section), title.folder)).then(
          () => true,
          () => false,
        ),
      ),
    );
    return titles.filter((_title, index) => present[index]);
  }

  private async actualLinks(): Promise<Link[]> {
    const users = await this.entries(this.paths.personalRoot());
    const folders = SECTIONS.flatMap((section) => [
      ...this.resolver.sharedShelves.map((shelf) => this.paths.shelf(shelf, section)),
      ...users.map((userId) => this.paths.personal(userId, section)),
    ]);
    return (await Promise.all(folders.map((folder) => this.linksIn(folder)))).flat();
  }

  private async entries(folder: string): Promise<string[]> {
    return this.fs.readdir(folder).catch((error: unknown) => {
      if (isMissing(error)) {
        return [];
      }
      throw error;
    });
  }

  private async linksIn(folder: string): Promise<Link[]> {
    const links = await Promise.all(
      (await this.entries(folder)).map(async (name) => {
        const linkPath = path.join(folder, name);
        const stats = await this.fs.lstat(linkPath);
        return stats.isSymbolicLink() ? { path: linkPath, target: await this.fs.readlink(linkPath) } : null;
      }),
    );
    return links.filter((link) => link !== null);
  }

  private async removeLink(link: Link): Promise<void> {
    const stats = await this.fs.lstat(link.path).catch(() => null);
    if (stats?.isSymbolicLink()) {
      await this.keepFolder(path.dirname(link.path));
      await this.fs.unlink(link.path);
    }
  }

  /**
   * Jellyfin never cleans a library whose folder is empty (it takes it for an unplugged drive):
   * the last title taken off a shelf would stay listed, unplayable. A hidden marker keeps every
   * shelf folder non-empty, so the next scan drops what left.
   */
  private async keepFolder(folder: string): Promise<void> {
    await this.fs
      .writeFile(path.join(folder, SHELF_MARKER), SHELF_MARKER_TEXT, { flag: 'wx' })
      .catch((error: unknown) => {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
          throw error;
        }
      });
  }

  private async createLink(link: Link): Promise<void> {
    const existing = await this.fs.lstat(link.path).catch(() => null);
    if (existing && !existing.isSymbolicLink()) {
      LibraryShelves.logger.warn(`Not shelving over a real folder: ${link.path}`);
      return;
    }
    await this.fs.mkdir(path.dirname(link.path), { recursive: true });
    await this.keepFolder(path.dirname(link.path));
    await this.fs.symlink(link.target, link.path);
  }

  /** Moves the library as it was before the store into it, one title folder at a time; idempotent. */
  async adopt(): Promise<void> {
    let adopted = 0;
    for (const section of SECTIONS) {
      for (const name of await this.entries(this.paths.shelf(STANDARD_SHELF, section))) {
        adopted += (await this.adoptOne(section, name)) ? 1 : 0;
      }
    }
    if (adopted > 0) {
      LibraryShelves.logger.log(`Adopted ${adopted} title folder(s) into the store`);
    }
  }

  private async adoptOne(section: LibrarySection, name: string): Promise<boolean> {
    const legacyFolder = path.join(this.paths.shelf(STANDARD_SHELF, section), name);
    const stats = await this.fs.lstat(legacyFolder);
    const imdbId = name.match(IMDB_TAG)?.[1];
    if (!stats.isDirectory() || stats.isSymbolicLink() || !imdbId) {
      return false;
    }
    const storeFolder = path.join(this.paths.store(section), name);
    if (
      await this.fs.lstat(storeFolder).then(
        () => true,
        () => false,
      )
    ) {
      LibraryShelves.logger.warn(`Cannot adopt ${legacyFolder}: ${storeFolder} already exists`);
      return false;
    }
    await this.titles.record({ section, folder: name, imdbId });
    await this.fs.mkdir(this.paths.store(section), { recursive: true });
    await this.fs.rename(legacyFolder, storeFolder);
    const link = linkTo(legacyFolder, storeFolder);
    await this.fs.symlink(link.target, link.path);
    return true;
  }
}
