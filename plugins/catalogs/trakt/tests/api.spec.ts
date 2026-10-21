import { PluginCache } from '@crn-flix/contracts';

import { TraktApi } from '../src';

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

/** Latest airing per show; shows absent here have aired nothing yet. */
const LAST_AIRED: Record<number, string> = { 3: '2026-10-14T01:00:00.000Z' };

const lastEpisode = (url: string) => {
  const showId = Number(url.split('/')[2]);
  const aired = LAST_AIRED[showId];
  return { status: aired ? 200 : 204, data: aired ? { first_aired: aired } : '', headers: {}, config: {} };
};

const get = jest.fn();
const respond = (url: string) =>
  Promise.resolve(
    url.endsWith('/last_episode') ? lastEpisode(url) : { status: 200, data: RESPONSES[url], headers: {}, config: {} },
  );

jest.mock('axios', () => ({
  __esModule: true,
  default: {
    create: () => ({ get, interceptors: { request: { use: jest.fn() }, response: { use: jest.fn() } } }),
  },
}));

const passThroughCache: PluginCache = { withCache: (_key, fn) => fn() };

const user = { id: 'user-1', accessToken: 'token' };

function buildApi(): TraktApi {
  return new TraktApi({ host: 'api.trakt.test', clientId: 'id', clientSecret: 'secret' }, passThroughCache);
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

describe('TraktApi progress of watched shows', () => {
  const failingProgress = (failing: string[]) => (url: string) =>
    failing.includes(url) ? Promise.reject(new Error('getaddrinfo EAI_AGAIN api.trakt.tv')) : respond(url);

  beforeEach(() => {
    RESPONSES['/sync/watched/shows'] = [watched(3, 'Watching'), watched(4, 'Other'), watched(5, 'Third')];
    RESPONSES['/shows/4/progress/watched'] = progress;
    RESPONSES['/shows/5/progress/watched'] = progress;
  });

  it('rejects the call, without any unhandled rejection, when progress lookups fail', async () => {
    const unhandled = jest.fn();
    process.on('unhandledRejection', unhandled);
    get.mockImplementation(failingProgress(['/shows/3/progress/watched', '/shows/5/progress/watched']));

    await expect(buildApi().getWatchingShows(user)).rejects.toThrow('EAI_AGAIN');
    await new Promise((resolve) => setImmediate(resolve));

    process.off('unhandledRejection', unhandled);
    expect(unhandled).not.toHaveBeenCalled();
  });
});

describe('TraktApi new airings', () => {
  const mapCache = (): PluginCache => {
    const store = new Map<string, unknown>();
    return {
      withCache: async <T>(key: string, fn: () => Promise<T>): Promise<T> => {
        // The latest airing has a short TTL: every read here stands for a refresh after it expired.
        if (key.startsWith('show-last-aired-')) {
          return fn();
        }
        if (!store.has(key)) {
          store.set(key, await fn());
        }
        return store.get(key) as T;
      },
    };
  };

  beforeEach(() => {
    get.mockImplementation(respond);
    RESPONSES['/sync/watched/shows'] = [
      watched(1, 'Hidden'),
      watched(3, 'Caught up'),
      { ...watched(6, 'Finished'), show: { ...show(6, 'Finished'), status: 'ended' } },
    ];
    RESPONSES['/shows/3/progress/watched'] = { ...progress, aired: 2, completed: 2, next_episode: null };
    RESPONSES['/shows/6/progress/watched'] = { ...progress, aired: 8, completed: 8, next_episode: null };
    LAST_AIRED[1] = '2026-10-30T01:00:00.000Z';
    LAST_AIRED[3] = '2026-10-14T01:00:00.000Z';
    LAST_AIRED[6] = '2026-10-29T01:00:00.000Z';
  });

  it('reports the latest airing among followed shows, ignoring hidden, dropped and finished ones', async () => {
    const latest = await buildApi().getLatestFollowedAiring(user);

    expect(latest?.toUTC().toISO()).toBe('2026-10-14T01:00:00.000Z');
  });

  it('reads the progress again once a new episode aired, though the user watched nothing', async () => {
    const api = new TraktApi({ host: 'api.trakt.test', clientId: 'id', clientSecret: 'secret' }, mapCache());
    expect(await api.getWatchingShows(user)).toEqual([]);

    LAST_AIRED[3] = '2026-10-21T01:00:00.000Z';
    RESPONSES['/shows/3/progress/watched'] = { ...progress, aired: 4, completed: 2 };

    expect((await api.getWatchingShows(user)).map((w) => w.show.title)).toEqual(['Caught up']);
  });
});
