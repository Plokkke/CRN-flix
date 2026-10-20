import { DateTime } from 'luxon';

import { Catalog, CatalogItem, MediaType, RequestReason } from '@crn-flix/contracts';

import { CatalogAccountsService } from '@/services/catalog/accounts';
import { CatalogSyncService, syncConfigSchema } from '@/services/catalog/sync';
import { MediasRepository } from '@/services/database/medias';
import { RequestsRepository, RequestStatus } from '@/services/database/requests';
import { UserActivitiesRepository } from '@/services/database/user-activities';
import { PlannerService } from '@/services/planner/planner';
import { TicketCategory } from '@/services/tickets/model';
import { TicketService } from '@/services/tickets/ticket.service';

import { UNTRACKED } from '../../helpers/integrations';

const CONFIG = syncConfigSchema.parse({});

const USER = { id: 'u1', jellyfinId: 'jf1', name: 'antoine', messagingKey: 'discord', messagingId: 'd1' };

function episode(season: number, number: number, imdbId = 'tt14688458'): CatalogItem {
  return {
    type: MediaType.Episode,
    imdbId,
    title: 'Silo',
    originalTitle: null,
    frenchTitle: null,
    originalLanguage: null,
    year: 2023,
    seasonNumber: season,
    episodeNumber: number,
    runtimeMinutes: 50,
    catalogSlug: 'silo',
  };
}

const SILO = [episode(1, 1), episode(1, 2), episode(2, 1)];

function buildStubs() {
  return {
    catalog: {
      name: 'test',
      reasons: Object.values(RequestReason),
      lastActivity: jest.fn().mockResolvedValue({}),
      listRequests: jest.fn().mockResolvedValue([]),
      playhead: jest.fn(),
    },
    accounts: {
      list: jest.fn().mockResolvedValue([{ user: USER, account: { userRef: 'u1', credentials: { token: 't' } } }]),
    },
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

type Stubs = ReturnType<typeof buildStubs>;

function buildService(stubs: Stubs): CatalogSyncService {
  return new CatalogSyncService(
    CONFIG,
    stubs.catalog as unknown as Catalog,
    stubs.accounts as unknown as CatalogAccountsService,
    stubs.userActivitiesRepository as unknown as UserActivitiesRepository,
    stubs.mediasRepository as unknown as MediasRepository,
    stubs.requestsRepository as unknown as RequestsRepository,
    stubs.planner as unknown as PlannerService,
    stubs.ticketService as unknown as TicketService,
    UNTRACKED,
  );
}

function answer(stubs: Stubs, byReason: Partial<Record<RequestReason, CatalogItem[]>>): void {
  stubs.catalog.listRequests.mockImplementation((_account, reason: RequestReason) =>
    Promise.resolve(byReason[reason] ?? []),
  );
}

describe('CatalogSyncService', () => {
  it('defaults the planner windows and drops the legacy buffer knobs', () => {
    expect(CONFIG.needWindowHours).toBe(5);
    expect(CONFIG.maxWindowHours).toBe(25);
    expect(CONFIG).not.toHaveProperty('bufferDuration');
  });

  it('creates one missing request per catalog item, carrying the user reason', async () => {
    const stubs = buildStubs();
    answer(stubs, { [RequestReason.Watchlisted]: SILO });

    await buildService(stubs).sync();

    expect(stubs.requestsRepository.upsert).toHaveBeenCalledTimes(3);
    for (const [, status] of stubs.requestsRepository.upsert.mock.calls) {
      expect(status).toBe(RequestStatus.Missing);
    }
    expect(stubs.mediasRepository.upsert.mock.calls[0][0]).toMatchObject({ traktSlug: 'silo', runtimeMinutes: 50 });
    expect(stubs.requestsRepository.setUserRequestReasons).toHaveBeenCalledWith(
      'media-1-1',
      'u1',
      new Set([RequestReason.Watchlisted]),
    );
  });

  it('merges the reasons of a media requested for several reasons', async () => {
    const stubs = buildStubs();
    answer(stubs, { [RequestReason.Watchlisted]: SILO, [RequestReason.Progress]: SILO });

    await buildService(stubs).sync();

    expect(stubs.requestsRepository.upsert).toHaveBeenCalledTimes(3);
    expect(stubs.requestsRepository.setUserRequestReasons).toHaveBeenCalledWith(
      'media-1-1',
      'u1',
      new Set([RequestReason.Watchlisted, RequestReason.Progress]),
    );
  });

  it('schedules one planner pass per show in progress', async () => {
    const stubs = buildStubs();
    answer(stubs, { [RequestReason.Progress]: SILO });

    await buildService(stubs).sync();

    expect(stubs.planner.schedulePass).toHaveBeenCalledTimes(1);
    expect(stubs.planner.schedulePass).toHaveBeenCalledWith({ kind: 'show', imdbId: 'tt14688458' });
  });

  it('schedules nothing when no show is in progress', async () => {
    const stubs = buildStubs();
    answer(stubs, { [RequestReason.Watchlisted]: SILO });

    await buildService(stubs).sync();

    expect(stubs.planner.schedulePass).not.toHaveBeenCalled();
  });

  it('only re-reads the reasons whose catalog activity moved since the last sync', async () => {
    const stubs = buildStubs();
    const now = new Date();
    const syncedNow = DateTime.fromJSDate(now);
    stubs.userActivitiesRepository.getForUserId.mockResolvedValue({
      WATCHLISTED: syncedNow,
      PROGRESS: syncedNow,
      HIGH_RATED: syncedNow,
    });
    stubs.catalog.lastActivity.mockResolvedValue({
      [RequestReason.Watchlisted]: new Date(now.getTime() + 60_000),
      [RequestReason.Progress]: new Date(now.getTime() - 60_000),
      [RequestReason.HighRated]: new Date(now.getTime() - 60_000),
    });

    await buildService(stubs).sync();

    expect(stubs.catalog.listRequests.mock.calls.map(([, reason]) => reason)).toEqual([RequestReason.Watchlisted]);
  });

  it('leaves an unreachable account out without touching it, and syncs the others', async () => {
    const stubs = buildStubs();
    const other = { ...USER, id: 'u2', name: 'other' };
    stubs.accounts.list.mockResolvedValue([
      { user: USER, account: { userRef: 'u1', credentials: { token: 'expired' } } },
      { user: other, account: { userRef: 'u2', credentials: { token: 't' } } },
    ]);
    stubs.catalog.listRequests.mockImplementation((account: { userRef: string }, reason: RequestReason) =>
      account.userRef === 'u1' && reason === RequestReason.Progress
        ? Promise.reject(new Error('Request failed with status code 401'))
        : Promise.resolve(SILO),
    );

    await buildService(stubs).sync();

    const [, syncedUserIds] = stubs.requestsRepository.listSyncSnapshot.mock.calls[0];
    expect(syncedUserIds).toEqual(['u2']);
    expect(stubs.requestsRepository.setUserRequestReasons.mock.calls.every(([, userId]) => userId === 'u2')).toBe(true);
    expect(stubs.userActivitiesRepository.upsert.mock.calls.every(([userId]) => userId === 'u2')).toBe(true);
  });

  describe('missing imdb ids', () => {
    it('opens one missing-imdb ticket per title the catalog has no imdb id for', async () => {
      const stubs = buildStubs();
      answer(stubs, { [RequestReason.Watchlisted]: [episode(1, 1, ''), episode(1, 2, '')] });

      await buildService(stubs).sync();

      expect(stubs.ticketService.open).toHaveBeenCalledTimes(1);
      const [category, subject, payload] = stubs.ticketService.open.mock.calls[0];
      expect(category).toBe(TicketCategory.MissingImdb);
      expect(subject).toEqual({ type: 'show', id: 'silo:2023' });
      expect(payload.kind).toBe('show');
      expect(payload.mediaIds).toHaveLength(2);
    });

    it('opens no ticket when every media has an imdb id', async () => {
      const stubs = buildStubs();
      answer(stubs, { [RequestReason.Watchlisted]: SILO });

      await buildService(stubs).sync();

      expect(stubs.ticketService.open).not.toHaveBeenCalled();
    });
  });
});
