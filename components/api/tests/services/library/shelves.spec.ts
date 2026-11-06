import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

import { Player } from '@crn-flix/contracts';

import { LibraryTitle, LibraryTitlesRepository } from '@/services/database/library';
import { LibraryPaths } from '@/services/library/paths';
import { LibraryShelves, SHELF_MARKER, ShelfResolver, STANDARD_ONLY } from '@/services/library/shelves';

const MOVIE = 'War (1999) [imdbid-tt1]';

function memoryTitles(): LibraryTitlesRepository & { rows: LibraryTitle[] } {
  const rows: LibraryTitle[] = [];
  return {
    rows,
    record: async (title: LibraryTitle) => {
      rows.splice(
        0,
        rows.length,
        ...rows.filter((r) => r.folder !== title.folder || r.section !== title.section),
        title,
      );
    },
    list: async () => [...rows],
  } as unknown as LibraryTitlesRepository & { rows: LibraryTitle[] };
}

describe('LibraryShelves', () => {
  let root: string;
  let paths: LibraryPaths;
  let player: { refreshLibrary: jest.Mock };

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'crn-flix-shelves-'));
    paths = new LibraryPaths({
      layout: 'shelves',
      mediasPath: root,
      moviesFolder: 'movies',
      seriesFolder: 'series',
      playerRoot: '/medias',
      kidsMaxParentalRating: 10,
    });
    player = { refreshLibrary: jest.fn().mockResolvedValue(undefined) };
  });

  afterEach(() => fs.rm(root, { recursive: true, force: true }));

  const shelves = (titles: LibraryTitlesRepository, resolver: ShelfResolver = STANDARD_ONLY) =>
    new LibraryShelves(paths, titles, resolver, player as unknown as Player);

  it('adopts the historical library: same path for the player, files now in the store', async () => {
    await fs.mkdir(path.join(root, 'movies', MOVIE), { recursive: true });
    await fs.writeFile(path.join(root, 'movies', MOVIE, 'War.mkv'), 'video');
    await fs.mkdir(path.join(root, 'movies', 'No tag'), { recursive: true });
    const titles = memoryTitles();

    await shelves(titles).adopt();

    expect((await fs.lstat(path.join(root, 'movies', MOVIE))).isSymbolicLink()).toBe(true);
    await expect(fs.readFile(path.join(root, 'movies', MOVIE, 'War.mkv'), 'utf8')).resolves.toBe('video');
    await expect(fs.readFile(path.join(root, 'store', 'movies', MOVIE, 'War.mkv'), 'utf8')).resolves.toBe('video');
    expect(titles.rows).toEqual([{ section: 'movies', folder: MOVIE, imdbId: 'tt1' }]);
    expect((await fs.lstat(path.join(root, 'movies', 'No tag'))).isDirectory()).toBe(true);
  });

  it('is idempotent: a second adoption changes nothing', async () => {
    await fs.mkdir(path.join(root, 'movies', MOVIE), { recursive: true });
    const titles = memoryTitles();
    const library = shelves(titles);

    await library.adopt();
    await library.adopt();
    await library.reconcile();

    expect(player.refreshLibrary).not.toHaveBeenCalled();
  });

  it('shows a placed title on its shelves and takes it off when it should no longer be there', async () => {
    await fs.mkdir(path.join(root, 'store', 'movies', MOVIE), { recursive: true });
    let shared: string | null = 'standard';
    const resolver: ShelfResolver = {
      sharedShelves: ['kids', 'standard'],
      shelvesOf: async () => () => ({ shared, personal: ['son'] }),
    };
    const titles = memoryTitles();
    const library = shelves(titles, resolver);

    await library.titlePlaced({ section: 'movies', folder: MOVIE, imdbId: 'tt1' });
    await fs.access(path.join(root, 'movies', MOVIE));
    await fs.access(path.join(root, 'shelves', 'users', 'son', 'movies', MOVIE));

    shared = 'kids';
    await library.reconcile();
    await expect(fs.lstat(path.join(root, 'movies', MOVIE))).rejects.toThrow();
    await fs.access(path.join(root, 'shelves', 'kids', 'movies', MOVIE));
    await fs.access(path.join(root, 'store', 'movies', MOVIE));
    expect(player.refreshLibrary).toHaveBeenCalledTimes(2);
  });

  it('keeps a shelf folder non-empty once its last title leaves, so the player drops that title', async () => {
    await fs.mkdir(path.join(root, 'store', 'movies', MOVIE), { recursive: true });
    let personal = ['son'];
    const resolver: ShelfResolver = {
      sharedShelves: ['kids', 'standard'],
      shelvesOf: async () => () => ({ shared: 'standard', personal }),
    };
    const library = shelves(memoryTitles(), resolver);
    await library.titlePlaced({ section: 'movies', folder: MOVIE, imdbId: 'tt1' });

    personal = [];
    await library.reconcile();

    const sonMovies = path.join(root, 'shelves', 'users', 'son', 'movies');
    await expect(fs.readdir(sonMovies)).resolves.toEqual([SHELF_MARKER]);
    expect(player.refreshLibrary).toHaveBeenCalledTimes(2);
  });

  it('never links a title whose store folder is gone', async () => {
    const titles = memoryTitles();
    await titles.record({ section: 'movies', folder: 'Ghost [imdbid-tt9]', imdbId: 'tt9' });

    await shelves(titles).reconcile();

    await expect(fs.readdir(path.join(root, 'movies'))).rejects.toThrow();
  });
});
