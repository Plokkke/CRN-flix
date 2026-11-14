import * as path from 'path';

import { LibraryTitle } from '@/services/database/library';

import { LibraryPaths } from './paths';

/** Where a title is shown: at most one shared shelf, plus the personal shelves of some users. */
export type TitleShelves = {
  shared: string | null;
  personal: string[];
};

/** A symbolic link: `path` is absolute, `target` relative to the link's folder (the player sees the volume elsewhere). */
export type Link = {
  path: string;
  target: string;
};

export function linkTo(linkPath: string, storeFolder: string): Link {
  return { path: linkPath, target: path.relative(path.dirname(linkPath), storeFolder) };
}

/** Every link the shelves should hold, from where each title of the store is shown. */
export function desiredLinks(
  titles: LibraryTitle[],
  shelvesOf: (imdbId: string) => TitleShelves,
  paths: LibraryPaths,
): Link[] {
  return titles.flatMap((title) => {
    const storeFolder = path.join(paths.store(title.section), title.folder);
    const { shared, personal } = shelvesOf(title.imdbId);
    const shelfFolders = [
      ...(shared ? [paths.shelf(shared, title.section)] : []),
      ...personal.map((userId) => paths.personal(userId, title.section)),
    ];
    return shelfFolders.map((shelfFolder) => linkTo(path.join(shelfFolder, title.folder), storeFolder));
  });
}

/** What to change so the shelves hold exactly the desired links; a link pointing elsewhere is replaced. */
export function diffLinks(desired: Link[], actual: Link[]): { create: Link[]; remove: Link[] } {
  const wanted = new Map(desired.map((link) => [link.path, link.target]));
  const present = new Map(actual.map((link) => [link.path, link.target]));
  return {
    create: desired.filter((link) => present.get(link.path) !== link.target),
    remove: actual.filter((link) => wanted.get(link.path) !== link.target),
  };
}
