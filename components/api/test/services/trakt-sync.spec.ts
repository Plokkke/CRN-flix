import { TraktPlugin } from '@/modules/jellyfin/plugins/trakt';
import { TraktApi } from '@/modules/trakt/api';
import { Episode, ProgressShow, Show } from '@/modules/trakt/types';
import { MediasRepository } from '@/services/database/medias';
import { RequestsRepository, RequestStatus } from '@/services/database/requests';
import { UserActivitiesRepository } from '@/services/database/user-activities';
import { UsersRepository } from '@/services/database/users';
import { PlannerService } from '@/services/planner/planner';
import { TicketCategory } from '@/services/tickets/model';
import { TicketService } from '@/services/tickets/ticket.service';
import { syncConfigSchema, TraktSyncService } from '@/services/trakt-sync';

const CONFIG = syncConfigSchema.parse({});

const show: Show = {
  title: 'Silo',
  year: 2023,
  ids: { trakt: 42, imdb: 'tt14688458' },
};

function buildEpisode(season: number, number: number): Episode {
  return { season, number, title: `S${season}E${number}`, ids: { trakt: season * 100 + number } };
}

type Stubs = {
  traktPlugin: { getUsersAuthContext: jest.Mock };
  traktClient: {
    requestShowDetails: jest.Mock;
    requestMovieDetails: jest.Mock;
    requestShowSeasonsDetails: jest.Mock;
    getWatchingShows: jest.Mock;
    requestUserWatchlist: jest.Mock;
    getHighRatedMedias: jest.Mock;
    getLastActivities: jest.Mock;
  };
  usersRepository: { list: jest.Mock };
  userActivitiesRepository: { getForUserId: jest.Mock; upsert: jest.Mock };
  mediasRepository: { upsert: jest.Mock };
  requestsRepository: {
    upsert: jest.Mock;
    setUserRequestReasons: jest.Mock;
    setUserRequestReason: jest.Mock;
    removeUserRequestReason: jest.Mock;
    listSyncSnapshot: jest.Mock;
  };
  planner: { schedulePass: jest.Mock };
  ticketService: { open: jest.Mock };
};

function buildStubs(): Stubs {
  return {
    traktPlugin: { getUsersAuthContext: jest.fn().mockResolvedValue([]) },
    traktClient: {
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
    },
    usersRepository: { list: jest.fn().mockResolvedValue([]) },
    userActivitiesRepository: {
      getForUserId: jest.fn().mockResolvedValue({ WATCHLISTED: null, PROGRESS: null, HIGH_RATED: null }),
      upsert: jest.fn().mockResolvedValue(undefined),
    },
    mediasRepository: {
      upsert: jest
        .fn()
        .mockImplementation((infos) =>
          Promise.resolve({ ...infos, id: `media-${infos.seasonNumber}-${infos.episodeNumber}` }),
        ),
    },
    requestsRepository: {
      upsert: jest.fn().mockImplementation((mediaId, status) => Promise.resolve({ mediaId, status })),
      setUserRequestReasons: jest.fn().mockResolvedValue(undefined),
      setUserRequestReason: jest.fn().mockResolvedValue(undefined),
      removeUserRequestReason: jest.fn().mockResolvedValue(undefined),
      listSyncSnapshot: jest.fn().mockResolvedValue([]),
    },
    planner: { schedulePass: jest.fn() },
    ticketService: { open: jest.fn().mockResolvedValue({ id: 't1' }) },
  };
}

function buildService(stubs: Stubs): TraktSyncService {
  return new TraktSyncService(
    CONFIG,
    stubs.traktPlugin as unknown as TraktPlugin,
    stubs.traktClient as unknown as TraktApi,
    stubs.usersRepository as unknown as UsersRepository,
    stubs.userActivitiesRepository as unknown as UserActivitiesRepository,
    stubs.mediasRepository as unknown as MediasRepository,
    stubs.requestsRepository as unknown as RequestsRepository,
    stubs.planner as unknown as PlannerService,
    stubs.ticketService as unknown as TicketService,
  );
}

function progressShow(nextEpisode: Episode | null): ProgressShow {
  return {
    show,
    aired: 5,
    completed: 3,
    last_watched_at: null,
    reset_at: null,
    seasons: [],
    hidden_seasons: [],
    next_episode: nextEpisode,
    last_episode: null,
  } as unknown as ProgressShow;
}

describe('TraktSyncService', () => {
  describe('config schema', () => {
    it('defaults the planner windows and drops the legacy buffer knobs', () => {
      expect(CONFIG.needWindowHours).toBe(5);
      expect(CONFIG.maxWindowHours).toBe(25);
      expect(CONFIG).not.toHaveProperty('bufferDuration');
    });
  });

  describe('sync with a watchlisted show', () => {
    function wireOneUser(stubs: Stubs): void {
      stubs.usersRepository.list.mockResolvedValue([
        { id: 'u1', jellyfinId: 'jf1', name: 'antoine', messagingKey: 'discord', messagingId: 'd1' },
      ]);
      stubs.traktPlugin.getUsersAuthContext.mockResolvedValue([{ jellyfinId: 'jf1', accessToken: 'tok' }]);
      stubs.traktClient.requestUserWatchlist.mockResolvedValue([{ type: 'show', show }]);
    }

    it('expands the full aired intent — no window truncation', async () => {
      const stubs = buildStubs();
      wireOneUser(stubs);

      await buildService(stubs).sync();

      // 6 episodes exist (specials excluded) but only 5 aired.
      expect(stubs.requestsRepository.upsert).toHaveBeenCalledTimes(5);
      const created = stubs.mediasRepository.upsert.mock.calls.map(([infos]) => infos);
      expect(created.map((m) => `${m.seasonNumber}:${m.episodeNumber}`)).toEqual(['1:1', '1:2', '1:3', '2:1', '2:2']);
      expect(created.every((m) => m.runtimeMinutes === 50)).toBe(true);
    });

    it('creates requests as missing intent carrying the user reason', async () => {
      const stubs = buildStubs();
      wireOneUser(stubs);

      await buildService(stubs).sync();

      for (const [, status] of stubs.requestsRepository.upsert.mock.calls) {
        expect(status).toBe(RequestStatus.Missing);
      }
      expect(stubs.requestsRepository.setUserRequestReasons).toHaveBeenCalledWith(
        'media-1-1',
        'u1',
        new Set(['WATCHLISTED']),
      );
    });
  });

  describe('progress shows', () => {
    function wireProgressUser(stubs: Stubs, progress: ProgressShow[]): void {
      stubs.usersRepository.list.mockResolvedValue([
        { id: 'u1', jellyfinId: 'jf1', name: 'antoine', messagingKey: 'discord', messagingId: 'd1' },
      ]);
      stubs.traktPlugin.getUsersAuthContext.mockResolvedValue([{ jellyfinId: 'jf1', accessToken: 'tok' }]);
      stubs.traktClient.getWatchingShows.mockResolvedValue(progress);
    }

    it('expands the whole show, not a window from the playhead', async () => {
      const stubs = buildStubs();
      wireProgressUser(stubs, [progressShow(buildEpisode(2, 1))]);

      await buildService(stubs).sync();

      expect(stubs.requestsRepository.upsert).toHaveBeenCalledTimes(5);
    });

    it('schedules a planner pass for every show in progress instead of persisting the playhead', async () => {
      const stubs = buildStubs();
      wireProgressUser(stubs, [progressShow(buildEpisode(2, 1))]);

      await buildService(stubs).sync();

      expect(stubs.planner.schedulePass).toHaveBeenCalledWith({ kind: 'show', imdbId: 'tt14688458' });
    });

    it('schedules nothing when no show is in progress', async () => {
      const stubs = buildStubs();
      wireProgressUser(stubs, []);

      await buildService(stubs).sync();

      expect(stubs.planner.schedulePass).not.toHaveBeenCalled();
    });
  });

  describe('missing imdb ids', () => {
    it('opens one missing-imdb ticket per title when Trakt has no imdb id', async () => {
      const stubs = buildStubs();
      stubs.usersRepository.list.mockResolvedValue([
        { id: 'u1', jellyfinId: 'jf1', name: 'antoine', messagingKey: 'discord', messagingId: 'd1' },
      ]);
      stubs.traktPlugin.getUsersAuthContext.mockResolvedValue([{ jellyfinId: 'jf1', accessToken: 'tok' }]);
      stubs.traktClient.requestUserWatchlist.mockResolvedValue([
        { type: 'show', show: { ...show, ids: { trakt: 42, imdb: null } } },
      ]);

      await buildService(stubs).sync();

      expect(stubs.ticketService.open).toHaveBeenCalledTimes(1);
      const [category, subject, payload] = stubs.ticketService.open.mock.calls[0];
      expect(category).toBe(TicketCategory.MissingImdb);
      expect(subject).toEqual({ type: 'show', id: 'silo:2023' });
      expect(payload.kind).toBe('show');
      expect(payload.mediaIds).toHaveLength(5);
    });

    it('opens no ticket when every media has an imdb id', async () => {
      const stubs = buildStubs();
      stubs.usersRepository.list.mockResolvedValue([
        { id: 'u1', jellyfinId: 'jf1', name: 'antoine', messagingKey: 'discord', messagingId: 'd1' },
      ]);
      stubs.traktPlugin.getUsersAuthContext.mockResolvedValue([{ jellyfinId: 'jf1', accessToken: 'tok' }]);
      stubs.traktClient.requestUserWatchlist.mockResolvedValue([{ type: 'show', show }]);

      await buildService(stubs).sync();

      expect(stubs.ticketService.open).not.toHaveBeenCalled();
    });
  });
});
