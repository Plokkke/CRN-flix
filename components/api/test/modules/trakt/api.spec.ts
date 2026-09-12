import { TraktApi } from '@/modules/trakt/api';
import { MemoryCacheService } from '@/services/cache/memory-cache.service';

const NOW = '2026-09-01T22:09:47.000Z';

const lastActivities = {
  all: NOW,
  movies: { watched_at: NOW, rated_at: null, hidden_at: null },
  episodes: { watched_at: NOW, rated_at: null },
  shows: { rated_at: null, hidden_at: NOW, dropped_at: NOW },
  seasons: { rated_at: null, hidden_at: null },
  lists: { liked_at: null },
  watchlist: { updated_at: null },
  favorites: { updated_at: null },
};

function show(trakt: number, title: string): Record<string, unknown> {
  return { title, year: 2020, ids: { trakt, imdb: `tt${trakt}` } };
}

function watched(trakt: number, title: string): Record<string, unknown> {
  return { plays: 1, last_watched_at: NOW, last_updated_at: NOW, reset_at: null, show: show(trakt, title) };
}

function hidden(trakt: number, title: string): Record<string, unknown> {
  return { hidden_at: NOW, show: show(trakt, title) };
}

const progress = {
  aired: 10,
  completed: 3,
  last_watched_at: NOW,
  reset_at: null,
  seasons: [],
  hidden_seasons: [],
  next_episode: { season: 1, number: 4, title: 'E4', ids: { trakt: 104 } },
  last_episode: null,
};

const RESPONSES: Record<string, unknown> = {
  '/sync/last_activities': lastActivities,
  '/users/hidden/progress_watched': [hidden(1, 'Hidden')],
  '/users/hidden/dropped': [hidden(2, 'Dropped')],
  '/sync/watched/shows': [watched(1, 'Hidden'), watched(2, 'Dropped'), watched(3, 'Watching')],
  '/shows/3/progress/watched': progress,
};

const get = jest.fn();
const respond = (url: string) => Promise.resolve({ status: 200, data: RESPONSES[url], headers: {}, config: {} });

jest.mock('axios', () => ({
  __esModule: true,
  default: {
    create: () => ({ get, interceptors: { request: { use: jest.fn() }, response: { use: jest.fn() } } }),
  },
}));

const user = { id: 'user-1', accessToken: 'token' };

function buildApi(): TraktApi {
  return new TraktApi({ host: 'api.trakt.test', clientId: 'id', clientSecret: 'secret' }, new MemoryCacheService());
}

describe('TraktApi hidden and dropped shows', () => {
  beforeEach(() => get.mockImplementation(respond));

  it('lists the shows of both the hidden and the dropped sections as excluded', async () => {
    const excluded = await buildApi().listExcludedShowIds(user);

    expect([...excluded].sort()).toEqual([1, 2]);
    expect(get).toHaveBeenCalledWith('/users/hidden/progress_watched', expect.anything());
    expect(get).toHaveBeenCalledWith('/users/hidden/dropped', expect.anything());
  });

  it('never reports a dropped show as being watched', async () => {
    const watching = await buildApi().getWatchingShows(user);

    expect(watching.map((w) => w.show.title)).toEqual(['Watching']);
    expect(get).not.toHaveBeenCalledWith('/shows/2/progress/watched', expect.anything());
  });
});
