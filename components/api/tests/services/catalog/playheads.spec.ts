import { Catalog, START_OF_SHOW } from '@crn-flix/contracts';

import { CatalogAccountsService } from '@/services/catalog/accounts';
import { CatalogPlayheadService } from '@/services/catalog/playheads';

const SHOW_IMDB = 'tt14688458';
const account = { userRef: 'user-1', credentials: { token: 't' } };

function buildService(playhead: jest.Mock) {
  const accounts = { list: jest.fn().mockResolvedValue([{ user: { id: 'user-1' }, account }]) };
  const catalog = { playhead };
  return new CatalogPlayheadService(accounts as unknown as CatalogAccountsService, catalog as unknown as Catalog);
}

describe('CatalogPlayheadService', () => {
  it('asks the catalog for the playhead of linked users', async () => {
    const playhead = jest.fn().mockResolvedValue({ nextSeason: 1, nextEpisode: 4 });

    await expect(buildService(playhead).getPlayheads(SHOW_IMDB, ['user-1'])).resolves.toEqual([
      { nextSeason: 1, nextEpisode: 4 },
    ]);
    expect(playhead).toHaveBeenCalledWith(account, SHOW_IMDB);
  });

  it('starts from the beginning for users without a catalog link', async () => {
    const playhead = jest.fn();

    await expect(buildService(playhead).getPlayheads(SHOW_IMDB, ['unknown-user'])).resolves.toEqual([START_OF_SHOW]);
    expect(playhead).not.toHaveBeenCalled();
  });

  it('starts from the beginning when the catalog fails', async () => {
    const playhead = jest.fn().mockRejectedValue(new Error('502'));

    await expect(buildService(playhead).getPlayheads(SHOW_IMDB, ['user-1'])).resolves.toEqual([START_OF_SHOW]);
  });
});
