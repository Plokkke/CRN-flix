import * as fsPromises from 'fs/promises';
import * as path from 'path';

import { Logger } from '@nestjs/common';

import { LibrarySection, Player } from '@crn-flix/contracts';

import { LibraryTitle, LibraryTitlesRepository } from '@/services/database/library';

import { desiredLinks, diffLinks, Link, linkTo, TitleShelves } from './links';
import { LibraryPaths, SECTIONS, STANDARD_SHELF } from './paths';

/** Decides where every title of the store is shown. */
export type ShelfResolver = {
  readonly sharedShelves: string[];
  shelvesOf(titles: LibraryTitle[]): Promise<(imdbId: string) => TitleShelves>;
};

/** Until the policy places titles, everything is on the standard shelf, as before the store. */
export const STANDARD_ONLY: ShelfResolver = {
  sharedShelves: [STANDARD_SHELF],
  shelvesOf: async () => () => ({ shared: STANDARD_SHELF, personal: [] }),
};

const IMDB_TAG = /\[imdbid-(tt\d+)\]/;

type Fs = Pick<
  typeof fsPromises,
  'readdir' | 'lstat' | 'readlink' | 'symlink' | 'unlink' | 'mkdir' | 'rename' | 'stat'
>;

const describeError = (error: unknown): string => (error instanceof Error ? error.message : String(error));

const isMissing = (error: unknown): boolean => (error as NodeJS.ErrnoException).code === 'ENOENT';

/**
 * Keeps the shelves (the folders the player scans) in line with where each title should be
 * shown: links are created and removed, never a file of the store. Real folders found in the
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
    private readonly fs: Fs = fsPromises,
  ) {}

  async titlePlaced(title: LibraryTitle): Promise<void> {
    await this.titles.record(title);
    await this.reconcile();
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

  private async pass(): Promise<void> {
    const titles = await this.presentTitles();
    const shelvesOf = await this.resolver.shelvesOf(titles);
    const desired = desiredLinks(titles, shelvesOf, this.paths);
    const { create, remove } = diffLinks(desired, await this.actualLinks());
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
      await this.fs.unlink(link.path);
    }
  }

  private async createLink(link: Link): Promise<void> {
    const existing = await this.fs.lstat(link.path).catch(() => null);
    if (existing && !existing.isSymbolicLink()) {
      LibraryShelves.logger.warn(`Not shelving over a real folder: ${link.path}`);
      return;
    }
    await this.fs.mkdir(path.dirname(link.path), { recursive: true });
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
