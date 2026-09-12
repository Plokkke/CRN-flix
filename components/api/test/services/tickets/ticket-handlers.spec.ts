import { JellyfinMediaService } from '@/modules/jellyfin/jellyfin';
import { DownloadJobsRepository, DownloadJobStatus } from '@/services/database/download-jobs';
import { MediasRepository } from '@/services/database/medias';
import { PlannedDownloadsRepository, PlannedDownloadStatus } from '@/services/database/planned-downloads';
import { RequestsRepository, RequestStatus } from '@/services/database/requests';
import { TicketsRepository } from '@/services/database/tickets';
import { UsersRepository, UserStatus } from '@/services/database/users';
import { FetchrSyncService } from '@/services/fetchr-sync';
import { MediaIdentifierService } from '@/services/media-identifier';
import { AllUserMessaging } from '@/services/messaging/user/all';
import { PlannerService } from '@/services/planner/planner';
import { PostDownloadPipeline } from '@/services/post-download-pipeline';
import { TicketCategory, TicketEntity, TicketStatus } from '@/services/tickets/model';
import { TICKET_ID_METADATA_KEY, TicketHandlersService } from '@/services/tickets/ticket-handlers';
import { TicketService } from '@/services/tickets/ticket.service';

function buildTicket(category: TicketCategory, payload: Record<string, unknown>): TicketEntity {
  return {
    id: 't1',
    category,
    subjectType: null,
    subjectId: null,
    status: TicketStatus.Open,
    title: 'ticket',
    summary: null,
    payload: payload as TicketEntity['payload'],
    attempts: 0,
    resolution: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    resolvedAt: null,
  };
}

function buildStubs() {
  return {
    ticketService: { registerHandler: jest.fn(), applyOperation: jest.fn() },
    ticketsRepository: { listen: jest.fn().mockReturnValue({ cleanup: jest.fn() }), get: jest.fn() },
    jellyfin: {
      resetUserPassword: jest.fn().mockResolvedValue(undefined),
      findUserByName: jest.fn().mockResolvedValue(null),
      registerUser: jest.fn().mockResolvedValue('jf-1'),
    },
    messaging: { registered: jest.fn(), error: jest.fn() },
    usersRepository: {
      get: jest.fn().mockResolvedValue({
        id: 'u1',
        name: 'antoine',
        jellyfinId: null,
        messagingKey: 'discord',
        messagingId: 'd1',
        status: UserStatus.Pending,
      }),
      setJellyfinId: jest.fn().mockResolvedValue(undefined),
      setStatus: jest.fn().mockResolvedValue(undefined),
      remove: jest.fn().mockResolvedValue(undefined),
    },
    requestsRepository: {
      updateStatusesBulk: jest.fn().mockResolvedValue(undefined),
      upsert: jest.fn().mockResolvedValue({ mediaId: 'm1' }),
      listUsers: jest.fn().mockResolvedValue([]),
      removeRequest: jest.fn().mockResolvedValue(undefined),
    },
    mediasRepository: {
      upsert: jest.fn().mockResolvedValue({ id: 'm1', imdbId: 'tt1234567', title: 'Movie' }),
      updateImdbId: jest.fn().mockResolvedValue(undefined),
    },
    plannedDownloads: {
      get: jest.fn().mockResolvedValue({
        id: 'a1',
        showImdbId: 'tt42',
        coveredMediaIds: ['m1', 'm2'],
        coveredStatuses: ['missing', 'missing'],
        scope: { kind: 'season', season: 1 },
        url: 'https://loadix.test/x',
        medias: [],
      }),
      updateStatus: jest.fn().mockResolvedValue(undefined),
    },
    postDownloadPipeline: { retryWithImdbId: jest.fn().mockResolvedValue(undefined) },
    fetchrSync: {
      canHandle: jest.fn().mockResolvedValue(true),
      download: jest.fn(),
      liveDownloads: jest.fn().mockReturnValue([]),
      updateMetadata: jest.fn(),
      resolve: jest.fn().mockResolvedValue({ fileName: 'Movie.2020.1080p.mkv', size: null }),
    },
    mediaIdentifier: {
      parseFilename: jest.fn().mockReturnValue({ title: 'Movie' }),
      identifyFromParsed: jest
        .fn()
        .mockResolvedValue({ imdbId: 'tt1234567', title: 'Movie', year: 2020, mediaType: 'movie' }),
      tmdbFindByImdbId: jest.fn().mockResolvedValue({ movies: [], tvShows: [] }),
    },
    planner: { schedulePass: jest.fn() },
    downloadJobs: { get: jest.fn().mockResolvedValue({ status: DownloadJobStatus.Completed, errorMessage: null }) },
  };
}

type Stubs = ReturnType<typeof buildStubs>;

function buildService(stubs: Stubs): TicketHandlersService {
  return new TicketHandlersService(
    stubs.ticketService as unknown as TicketService,
    stubs.ticketsRepository as unknown as TicketsRepository,
    stubs.jellyfin as unknown as JellyfinMediaService,
    stubs.messaging as unknown as AllUserMessaging,
    stubs.usersRepository as unknown as UsersRepository,
    stubs.requestsRepository as unknown as RequestsRepository,
    stubs.mediasRepository as unknown as MediasRepository,
    stubs.plannedDownloads as unknown as PlannedDownloadsRepository,
    stubs.postDownloadPipeline as unknown as PostDownloadPipeline,
    stubs.fetchrSync as unknown as FetchrSyncService,
    stubs.mediaIdentifier as unknown as MediaIdentifierService,
    stubs.planner as unknown as PlannerService,
    stubs.downloadJobs as unknown as DownloadJobsRepository,
  );
}

type Handler = (t: TicketEntity, op: unknown) => Promise<{ status: string; message: string }>;

function handlerFor(stubs: Stubs, category: TicketCategory): Handler {
  buildService(stubs).onModuleInit();
  const call = stubs.ticketService.registerHandler.mock.calls.find(([c]) => c === category);
  return call![1] as Handler;
}

describe('TicketHandlersService', () => {
  describe('user-approval', () => {
    it('creates the Jellyfin account, activates the user and resolves', async () => {
      const stubs = buildStubs();
      const handle = handlerFor(stubs, TicketCategory.UserApproval);

      const outcome = await handle(buildTicket(TicketCategory.UserApproval, { userId: 'u1' }), { kind: 'approve' });

      expect(outcome.status).toBe('resolved');
      expect(stubs.usersRepository.setJellyfinId).toHaveBeenCalledWith('u1', 'jf-1');
      expect(stubs.usersRepository.setStatus).toHaveBeenCalledWith('u1', UserStatus.Active);
      expect(stubs.messaging.registered).toHaveBeenCalled();
    });

    it('keeps the ticket open when Jellyfin fails (no more zombie approvals)', async () => {
      const stubs = buildStubs();
      stubs.jellyfin.registerUser.mockRejectedValue(new Error('jellyfin down'));
      const handle = handlerFor(stubs, TicketCategory.UserApproval);

      const outcome = await handle(buildTicket(TicketCategory.UserApproval, { userId: 'u1' }), { kind: 'approve' });

      expect(outcome.status).toBe('failed');
      expect(outcome.message).toContain('jellyfin down');
      expect(stubs.usersRepository.setStatus).not.toHaveBeenCalled();
    });

    it('rejects by deleting the user after notifying them', async () => {
      const stubs = buildStubs();
      const handle = handlerFor(stubs, TicketCategory.UserApproval);

      const outcome = await handle(buildTicket(TicketCategory.UserApproval, { userId: 'u1' }), { kind: 'reject' });

      expect(outcome.status).toBe('resolved');
      expect(stubs.messaging.error).toHaveBeenCalled();
      expect(stubs.usersRepository.remove).toHaveBeenCalledWith('u1');
    });
  });

  describe('download-action', () => {
    it('fails a submitted link no fetchr plugin can handle', async () => {
      const stubs = buildStubs();
      stubs.fetchrSync.canHandle.mockResolvedValue(false);
      const handle = handlerFor(stubs, TicketCategory.DownloadAction);

      const outcome = await handle(buildTicket(TicketCategory.DownloadAction, { actionId: 'a1' }), {
        kind: 'submitLink',
        url: 'https://x',
      });

      expect(outcome.status).toBe('failed');
      expect(stubs.fetchrSync.download).not.toHaveBeenCalled();
    });

    it('launches the submitted link and flips the action to downloading', async () => {
      const stubs = buildStubs();
      const handle = handlerFor(stubs, TicketCategory.DownloadAction);

      const outcome = await handle(buildTicket(TicketCategory.DownloadAction, { actionId: 'a1' }), {
        kind: 'submitLink',
        url: 'https://dl.test/file',
      });

      expect(outcome.status).toBe('progress');
      expect(stubs.fetchrSync.download).toHaveBeenCalledWith('https://dl.test/file', expect.any(Object));
      expect(stubs.plannedDownloads.updateStatus).toHaveBeenCalledWith('a1', PlannedDownloadStatus.Downloading);
    });

    it('reject bulk-rejects the covered requests and reschedules the planner', async () => {
      const stubs = buildStubs();
      const handle = handlerFor(stubs, TicketCategory.DownloadAction);

      const outcome = await handle(buildTicket(TicketCategory.DownloadAction, { actionId: 'a1' }), { kind: 'reject' });

      expect(outcome.status).toBe('progress');
      expect(stubs.requestsRepository.updateStatusesBulk).toHaveBeenCalledWith(['m1', 'm2'], RequestStatus.Rejected);
      expect(stubs.planner.schedulePass).toHaveBeenCalledWith({ kind: 'show', imdbId: 'tt42' });
    });

    it('restore un-rejects and resolves the ticket', async () => {
      const stubs = buildStubs();
      const handle = handlerFor(stubs, TicketCategory.DownloadAction);

      const outcome = await handle(buildTicket(TicketCategory.DownloadAction, { actionId: 'a1' }), { kind: 'restore' });

      expect(outcome.status).toBe('resolved');
      expect(stubs.requestsRepository.updateStatusesBulk).toHaveBeenCalledWith(['m1', 'm2'], RequestStatus.Missing);
    });
  });

  describe('identification-failure', () => {
    it('resolves when the retry completes the job', async () => {
      const stubs = buildStubs();
      const handle = handlerFor(stubs, TicketCategory.IdentificationFailure);

      const outcome = await handle(
        buildTicket(TicketCategory.IdentificationFailure, {
          jobId: 'j1',
          packageName: 'p',
          failedFiles: [],
          errorMessage: 'x',
        }),
        { kind: 'submitImdb', imdbId: 'tt1234567' },
      );

      expect(stubs.postDownloadPipeline.retryWithImdbId).toHaveBeenCalledWith('j1', 'tt1234567');
      expect(outcome.status).toBe('resolved');
    });

    it('stays open with the new error when the retry fails again', async () => {
      const stubs = buildStubs();
      stubs.downloadJobs.get.mockResolvedValue({ status: DownloadJobStatus.Failed, errorMessage: 'still broken' });
      const handle = handlerFor(stubs, TicketCategory.IdentificationFailure);

      const outcome = await handle(
        buildTicket(TicketCategory.IdentificationFailure, {
          jobId: 'j1',
          packageName: 'p',
          failedFiles: [],
          errorMessage: 'x',
        }),
        { kind: 'submitImdb', imdbId: 'tt1234567' },
      );

      expect(outcome).toMatchObject({ status: 'failed', message: 'still broken' });
    });
  });

  describe('manual-download', () => {
    it('resolves the link, identifies it and launches the download with the ticket metadata', async () => {
      const stubs = buildStubs();
      const handle = handlerFor(stubs, TicketCategory.ManualDownload);

      const outcome = await handle(buildTicket(TicketCategory.ManualDownload, { url: 'https://x' }), {
        kind: 'submitLink',
        url: 'https://x',
      });

      expect(outcome.status).toBe('progress');
      expect(stubs.fetchrSync.download).toHaveBeenCalledWith(
        'https://x',
        expect.objectContaining({ [TICKET_ID_METADATA_KEY]: 't1' }),
      );
      expect(stubs.requestsRepository.upsert).toHaveBeenCalledWith('m1', RequestStatus.Pending);
    });

    it('fails with the resume state in the payload when identification misses', async () => {
      const stubs = buildStubs();
      stubs.mediaIdentifier.identifyFromParsed.mockResolvedValue(null);
      const handle = handlerFor(stubs, TicketCategory.ManualDownload);

      const outcome = await handle(buildTicket(TicketCategory.ManualDownload, { url: 'https://x' }), {
        kind: 'submitLink',
        url: 'https://x',
      });

      expect(outcome).toMatchObject({ status: 'failed' });
      expect(stubs.fetchrSync.download).not.toHaveBeenCalled();
    });

    it('recovers via a forced IMDb id', async () => {
      const stubs = buildStubs();
      stubs.mediaIdentifier.tmdbFindByImdbId.mockResolvedValue({
        movies: [{ title: 'Movie', release_date: '2020-01-01' }],
        tvShows: [],
      });
      const handle = handlerFor(stubs, TicketCategory.ManualDownload);

      const outcome = await handle(buildTicket(TicketCategory.ManualDownload, { url: 'https://x' }), {
        kind: 'submitImdb',
        imdbId: 'tt1234567',
      });

      expect(outcome.status).toBe('progress');
      expect(stubs.fetchrSync.download).toHaveBeenCalled();
    });

    describe('with the download still running in Fetchr', () => {
      const inFlight = (status: string) => ({ id: 'd1', status, metadata: { [TICKET_ID_METADATA_KEY]: 't1' } });
      const tmdbMovie = { movies: [{ title: 'Right Movie', release_date: '2021-01-01' }], tvShows: [] };

      it('re-points the ticket at the corrected request instead of relaunching', async () => {
        const stubs = buildStubs();
        stubs.fetchrSync.liveDownloads.mockReturnValue([inFlight('downloading')]);
        stubs.mediaIdentifier.tmdbFindByImdbId.mockResolvedValue(tmdbMovie);
        stubs.mediasRepository.upsert.mockResolvedValue({ id: 'm2', imdbId: 'tt7654321', title: 'Right Movie' });
        const handle = handlerFor(stubs, TicketCategory.ManualDownload);

        const outcome = await handle(
          buildTicket(TicketCategory.ManualDownload, { url: 'https://x', imdbId: 'tt1234567', requestId: 'm1' }),
          { kind: 'submitImdb', imdbId: 'tt7654321' },
        );

        expect(outcome.status).toBe('progress');
        expect(stubs.fetchrSync.download).not.toHaveBeenCalled();
        expect(stubs.fetchrSync.updateMetadata).toHaveBeenCalledWith(
          'd1',
          expect.objectContaining({ 'crn-flix-request-id': 'm2', imdbid: 'tt7654321', [TICKET_ID_METADATA_KEY]: 't1' }),
        );
        expect(stubs.requestsRepository.upsert).toHaveBeenCalledWith('m2', RequestStatus.Pending);
        expect(outcome).toMatchObject({ payloadPatch: { imdbId: 'tt7654321', requestId: 'm2' } });
        expect(stubs.requestsRepository.removeRequest).toHaveBeenCalledWith('m1');
      });

      it('drops the misidentified request only when nobody asked for it', async () => {
        const stubs = buildStubs();
        stubs.fetchrSync.liveDownloads.mockReturnValue([inFlight('queued')]);
        stubs.mediaIdentifier.tmdbFindByImdbId.mockResolvedValue(tmdbMovie);
        stubs.mediasRepository.upsert.mockResolvedValue({ id: 'm2', imdbId: 'tt7654321', title: 'Right Movie' });
        stubs.requestsRepository.listUsers.mockResolvedValue([{ userId: 'u1' }]);
        const handle = handlerFor(stubs, TicketCategory.ManualDownload);

        await handle(buildTicket(TicketCategory.ManualDownload, { url: 'https://x', requestId: 'm1' }), {
          kind: 'submitImdb',
          imdbId: 'tt7654321',
        });

        expect(stubs.requestsRepository.listUsers).toHaveBeenCalledWith('m1');
        expect(stubs.requestsRepository.removeRequest).not.toHaveBeenCalled();
      });

      it('relaunches when the previous download already failed', async () => {
        const stubs = buildStubs();
        stubs.fetchrSync.liveDownloads.mockReturnValue([inFlight('failed')]);
        stubs.mediaIdentifier.tmdbFindByImdbId.mockResolvedValue(tmdbMovie);
        const handle = handlerFor(stubs, TicketCategory.ManualDownload);

        await handle(buildTicket(TicketCategory.ManualDownload, { url: 'https://x', requestId: 'm1' }), {
          kind: 'submitImdb',
          imdbId: 'tt7654321',
        });

        expect(stubs.fetchrSync.download).toHaveBeenCalled();
      });
    });
  });

  describe('missing-imdb', () => {
    it('rejects malformed imdb ids', async () => {
      const stubs = buildStubs();
      const handle = handlerFor(stubs, TicketCategory.MissingImdb);

      const outcome = await handle(
        buildTicket(TicketCategory.MissingImdb, { title: 'Silo', year: 2023, kind: 'show', mediaIds: ['m1'] }),
        { kind: 'submitImdb', imdbId: 'nope' },
      );

      expect(outcome.status).toBe('failed');
      expect(stubs.mediasRepository.updateImdbId).not.toHaveBeenCalled();
    });

    it('writes the imdb id on every media of the group and reschedules the show', async () => {
      const stubs = buildStubs();
      const handle = handlerFor(stubs, TicketCategory.MissingImdb);

      const outcome = await handle(
        buildTicket(TicketCategory.MissingImdb, { title: 'Silo', year: 2023, kind: 'show', mediaIds: ['m1', 'm2'] }),
        { kind: 'submitImdb', imdbId: 'tt14688458' },
      );

      expect(outcome.status).toBe('resolved');
      expect(stubs.mediasRepository.updateImdbId).toHaveBeenCalledTimes(2);
      expect(stubs.planner.schedulePass).toHaveBeenCalledWith({ kind: 'show', imdbId: 'tt14688458' });
    });
  });

  describe('manual-download first attempt', () => {
    it('fires a submitLink operation as soon as a manual-download ticket is created', async () => {
      const stubs = buildStubs();
      stubs.ticketsRepository.get.mockResolvedValue(buildTicket(TicketCategory.ManualDownload, { url: 'https://x' }));
      buildService(stubs).onModuleInit();

      const listeners = stubs.ticketsRepository.listen.mock.calls[0][0];
      await listeners.created({ ticketId: 't1' });

      expect(stubs.ticketService.applyOperation).toHaveBeenCalledWith(
        't1',
        { kind: 'submitLink', url: 'https://x' },
        'system',
      );
    });
  });
});
