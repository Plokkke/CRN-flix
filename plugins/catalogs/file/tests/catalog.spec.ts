import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

import { MediaType, RequestReason, START_OF_SHOW } from '@crn-flix/contracts';

import { FileCatalog } from '../src';

const FILE = {
  accounts: [
    {
      playerAccountId: 'jf-leo',
      requests: {
        WATCHLISTED: [{ type: 'movie', imdbId: 'tt0317219', title: 'Cars', year: 2006 }],
        PROGRESS: [{ type: 'show', imdbId: 'tt7678620', title: 'Bluey', year: 2018, season: 1, episodes: [1, 2] }],
      },
      playheads: { tt7678620: { nextSeason: 1, nextEpisode: 2 } },
    },
  ],
};

describe('FileCatalog', () => {
  let folder: string;
  let file: string;
  const leo = { userRef: 'u-leo', credentials: { playerAccountId: 'jf-leo' } };

  beforeEach(async () => {
    folder = await fs.mkdtemp(path.join(os.tmpdir(), 'crn-flix-catalog-'));
    file = path.join(folder, 'catalog.json');
    await fs.writeFile(file, JSON.stringify(FILE));
  });

  afterEach(() => fs.rm(folder, { recursive: true, force: true }));

  it('lists the accounts by player account, as the engine ties them to users', async () => {
    await expect(new FileCatalog(file).listAccounts()).resolves.toEqual([
      { playerAccountId: 'jf-leo', credentials: { playerAccountId: 'jf-leo' } },
    ]);
  });

  it('expands a show into its episodes and leaves unknown reasons empty', async () => {
    const catalog = new FileCatalog(file);

    const progress = await catalog.listRequests(leo, RequestReason.Progress);

    expect(progress.map((item) => [item.type, item.seasonNumber, item.episodeNumber])).toEqual([
      [MediaType.Episode, 1, 1],
      [MediaType.Episode, 1, 2],
    ]);
    expect((await catalog.listRequests(leo, RequestReason.Watchlisted))[0]).toMatchObject({
      imdbId: 'tt0317219',
      type: MediaType.Movie,
    });
    await expect(catalog.listRequests(leo, RequestReason.HighRated)).resolves.toEqual([]);
  });

  it('reads the playheads, a show never watched starting at the beginning', async () => {
    const catalog = new FileCatalog(file);

    await expect(catalog.playhead(leo, 'tt7678620')).resolves.toEqual({ nextSeason: 1, nextEpisode: 2 });
    await expect(catalog.playhead(leo, 'tt14688458')).resolves.toEqual(START_OF_SHOW);
  });

  it('reads the file again on every call, its modification time being the last activity', async () => {
    const catalog = new FileCatalog(file);
    await fs.writeFile(file, JSON.stringify({ accounts: [] }));
    const edited = new Date('2026-11-13T10:00:00Z');
    await fs.utimes(file, edited, edited);

    await expect(catalog.listAccounts()).resolves.toEqual([]);
    await expect(catalog.lastActivity()).resolves.toEqual({
      WATCHLISTED: edited,
      PROGRESS: edited,
      HIGH_RATED: edited,
    });
  });

  it('refuses a malformed file loudly', async () => {
    await fs.writeFile(file, JSON.stringify({ accounts: [{ requests: {} }] }));

    await expect(new FileCatalog(file).listAccounts()).rejects.toThrow();
  });
});
