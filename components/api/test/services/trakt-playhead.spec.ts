import { TraktPlugin } from '@/modules/jellyfin/plugins/trakt';
import { TraktApi } from '@/modules/trakt/api';
import { UsersRepository } from '@/services/database/users';
import { START_OF_SHOW } from '@/services/planner/model';
import { TraktPlayheadService } from '@/services/trakt-playhead';

const SHOW_IMDB = 'tt14688458';
const watchedEntry = { show: { title: 'Silo', year: 2023, ids: { trakt: 42, imdb: SHOW_IMDB } } };

function buildService(stubs: { excluded: number[]; nextEpisode: { season: number; number: number } | null }) {
  const traktClient = {
    requestUserWatched: jest.fn().mockResolvedValue([watchedEntry]),
    listExcludedShowIds: jest.fn().mockResolvedValue(new Set(stubs.excluded)),
    requestShowProgress: jest.fn().mockResolvedValue({ aired: 10, completed: 3, next_episode: stubs.nextEpisode }),
  };
  const usersRepository = { list: jest.fn().mockResolvedValue([{ id: 'user-1', jellyfinId: 'jf-1' }]) };
  const traktPlugin = { getUsersAuthContext: jest.fn().mockResolvedValue([{ jellyfinId: 'jf-1', accessToken: 't' }]) };

  return {
    traktClient,
    service: new TraktPlayheadService(
      usersRepository as unknown as UsersRepository,
      traktPlugin as unknown as TraktPlugin,
      traktClient as unknown as TraktApi,
    ),
  };
}

describe('TraktPlayheadService', () => {
  it('reads the playhead from the show progress when the show is still watched', async () => {
    const { service } = buildService({ excluded: [], nextEpisode: { season: 1, number: 4 } });

    await expect(service.getPlayheads(SHOW_IMDB, ['user-1'])).resolves.toEqual([{ nextSeason: 1, nextEpisode: 4 }]);
  });

  it('treats a dropped or hidden show as completed without asking for its progress', async () => {
    const { service, traktClient } = buildService({ excluded: [42], nextEpisode: { season: 1, number: 4 } });

    await expect(service.getPlayheads(SHOW_IMDB, ['user-1'])).resolves.toEqual([
      { nextSeason: null, nextEpisode: null },
    ]);
    expect(traktClient.requestShowProgress).not.toHaveBeenCalled();
  });

  it('starts from the beginning for users without a Trakt link', async () => {
    const { service } = buildService({ excluded: [], nextEpisode: null });

    await expect(service.getPlayheads(SHOW_IMDB, ['unknown-user'])).resolves.toEqual([START_OF_SHOW]);
  });
});
