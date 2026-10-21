import { DateTime } from 'luxon';

import { CatalogAccount, CatalogAccountRevokedError, RequestReason, START_OF_SHOW } from '@crn-flix/contracts';

import { Episode, ProgressShow, Show, TraktApi, TraktCatalog } from '../src';

const show: Show = {
  title: 'Silo',
  year: 2023,
  ids: { trakt: 42, imdb: 'tt14688458', slug: 'silo' },
} as Show;

const account: CatalogAccount = { userRef: 'user-1', credentials: { accessToken: 'tok' } };

function buildEpisode(season: number, number: number): Episode {
  return { season, number, title: `S${season}E${number}`, ids: { trakt: season * 100 + number } } as Episode;
}

function progressShow(nextEpisode: Episode | null): ProgressShow {
  return { show, aired: 5, completed: 3, next_episode: nextEpisode } as unknown as ProgressShow;
}

function buildApi() {
  return {
    requestShowDetails: jest.fn().mockResolvedValue({ aired_episodes: 5, runtime: 50 }),
    requestMovieDetails: jest.fn().mockResolvedValue({ runtime: 104 }),
    requestShowSeasonsDetails: jest.fn().mockResolvedValue([
      { number: 0, episodes: [buildEpisode(0, 1)] },
      { number: 1, episodes: [buildEpisode(1, 1), buildEpisode(1, 2), buildEpisode(1, 3)] },
      { number: 2, episodes: [buildEpisode(2, 1), buildEpisode(2, 2), buildEpisode(2, 3)] },
    ]),
    getWatchingShows: jest.fn().mockResolvedValue([]),
    requestUserWatchlist: jest.fn().mockResolvedValue([]),
    getHighRatedMedias: jest.fn().mockResolvedValue([]),
    getLastActivities: jest.fn().mockResolvedValue({}),
    getLatestFollowedAiring: jest.fn().mockResolvedValue(null),
    requestUserWatched: jest.fn().mockResolvedValue([{ show }]),
    listExcludedShowIds: jest.fn().mockResolvedValue(new Set()),
    requestShowProgress: jest.fn().mockResolvedValue({ aired: 10, completed: 3, next_episode: null }),
    refreshTokens: jest.fn().mockResolvedValue({ accessToken: 'new', refreshToken: 'r2', accessTokenExpiration: 'x' }),
  };
}

function buildCatalog(api = buildApi()) {
  return { api, catalog: new TraktCatalog(api as unknown as TraktApi, { ratingThreshold: 8 }) };
}

describe('TraktCatalog', () => {
  describe('listRequests', () => {
    it('expands a watchlisted show into its full aired intent, specials excluded', async () => {
      const { api, catalog } = buildCatalog();
      api.requestUserWatchlist.mockResolvedValue([{ type: 'show', show }]);

      const items = await catalog.listRequests(account, RequestReason.Watchlisted);

      expect(items.map((m) => `${m.seasonNumber}:${m.episodeNumber}`)).toEqual(['1:1', '1:2', '1:3', '2:1', '2:2']);
      expect(items.every((m) => m.runtimeMinutes === 50 && m.imdbId === 'tt14688458')).toBe(true);
      expect(items[0].catalogSlug).toBe('silo');
      expect(api.requestUserWatchlist).toHaveBeenCalledWith({ id: 'user-1', accessToken: 'tok' }, true);
    });

    it('expands a show in progress entirely, not a window from the playhead', async () => {
      const { api, catalog } = buildCatalog();
      api.getWatchingShows.mockResolvedValue([progressShow(buildEpisode(2, 1))]);

      await expect(catalog.listRequests(account, RequestReason.Progress)).resolves.toHaveLength(5);
    });

    it('fetches the runtime of a movie that comes without one', async () => {
      const { api, catalog } = buildCatalog();
      api.getHighRatedMedias.mockResolvedValue([
        { type: 'movie', movie: { title: 'Dune', year: 2021, ids: { trakt: 7, imdb: 'tt1160419' } } },
      ]);

      const [movie] = await catalog.listRequests(account, RequestReason.HighRated);

      expect(api.getHighRatedMedias).toHaveBeenCalledWith(expect.anything(), 8);
      expect(movie).toMatchObject({ imdbId: 'tt1160419', runtimeMinutes: 104, seasonNumber: null });
    });

    it('rejects credentials it did not issue', async () => {
      const { catalog } = buildCatalog();

      await expect(
        catalog.listRequests({ userRef: 'u', credentials: {} }, RequestReason.Watchlisted),
      ).rejects.toThrow();
    });
  });

  describe('lastActivity', () => {
    it('keeps the latest activity among the ones behind each reason', async () => {
      const { api, catalog } = buildCatalog();
      const older = DateTime.fromISO('2026-10-01T10:00:00Z');
      const newer = DateTime.fromISO('2026-10-02T10:00:00Z');
      api.getLastActivities.mockResolvedValue({
        watchlist: { updated_at: older },
        movies: { rated_at: older, watched_at: null },
        shows: { rated_at: newer, hidden_at: null, dropped_at: null },
      });

      const activity = await catalog.lastActivity(account);

      expect(activity[RequestReason.Watchlisted]).toEqual(older.toJSDate());
      expect(activity[RequestReason.HighRated]).toEqual(newer.toJSDate());
      expect(activity[RequestReason.Progress]).toBeNull();
    });

    it('counts a new episode of a followed show as a progress activity', async () => {
      const { api, catalog } = buildCatalog();
      const watched = DateTime.fromISO('2026-10-17T10:05:07Z');
      const aired = DateTime.fromISO('2026-10-21T01:00:00Z');
      api.getLastActivities.mockResolvedValue({ episodes: { watched_at: watched }, shows: {}, movies: {} });
      api.getLatestFollowedAiring.mockResolvedValue(aired);

      expect((await catalog.lastActivity(account))[RequestReason.Progress]).toEqual(aired.toJSDate());
    });
  });

  describe('playhead', () => {
    it('reads the next episode from the show progress while the show is watched', async () => {
      const { api, catalog } = buildCatalog();
      api.requestShowProgress.mockResolvedValue({ aired: 10, completed: 3, next_episode: { season: 1, number: 4 } });

      await expect(catalog.playhead(account, 'tt14688458')).resolves.toEqual({ nextSeason: 1, nextEpisode: 4 });
    });

    it('treats a dropped or hidden show as completed without asking for its progress', async () => {
      const { api, catalog } = buildCatalog();
      api.listExcludedShowIds.mockResolvedValue(new Set([42]));

      await expect(catalog.playhead(account, 'tt14688458')).resolves.toEqual({ nextSeason: null, nextEpisode: null });
      expect(api.requestShowProgress).not.toHaveBeenCalled();
    });

    it('starts from the beginning of a show the user never watched', async () => {
      const { catalog } = buildCatalog();

      await expect(catalog.playhead(account, 'tt0000000')).resolves.toEqual(START_OF_SHOW);
    });
  });

  describe('renewCredentials', () => {
    const NOW = new Date('2026-10-20T12:00:00Z');
    const expiringAt = (iso: string) => ({ accessToken: 'tok', refreshToken: 'r1', accessTokenExpiration: iso });

    it('keeps credentials valid for more than a day', async () => {
      const { api, catalog } = buildCatalog();

      await expect(catalog.renewCredentials(expiringAt('2026-10-22T12:00:00Z'), NOW)).resolves.toBeNull();
      expect(api.refreshTokens).not.toHaveBeenCalled();
    });

    it('renews credentials expiring within a day, or already expired', async () => {
      const { api, catalog } = buildCatalog();

      await expect(catalog.renewCredentials(expiringAt('2026-10-21T06:00:00Z'), NOW)).resolves.toMatchObject({
        accessToken: 'new',
      });
      await catalog.renewCredentials(expiringAt('2026-10-18T02:04:29Z'), NOW);
      expect(api.refreshTokens).toHaveBeenCalledWith('r1');
    });

    it('asks the user to link again when Trakt refuses the refresh token or none exists', async () => {
      const { api, catalog } = buildCatalog();
      api.refreshTokens.mockResolvedValue(null);

      await expect(catalog.renewCredentials(expiringAt('2026-10-18T02:04:29Z'), NOW)).rejects.toThrow(
        CatalogAccountRevokedError,
      );
      await expect(catalog.renewCredentials({ accessTokenExpiration: '0001-01-01T00:00:00Z' }, NOW)).rejects.toThrow(
        CatalogAccountRevokedError,
      );
    });
  });
});
