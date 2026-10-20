import { TicketsRepository } from '@/services/database/tickets';
import { OperationOutcome, TicketCategory, TicketEntity, TicketStatus } from '@/services/tickets/model';
import { TicketService } from '@/services/tickets/ticket.service';

function buildTicket(overrides: Partial<TicketEntity> = {}): TicketEntity {
  return {
    id: 't1',
    category: TicketCategory.MissingImdb,
    subjectType: 'show',
    subjectId: 'trakt:42',
    status: TicketStatus.Open,
    title: 'IMDb inconnu — Silo',
    summary: null,
    payload: { title: 'Silo', year: 2023, kind: 'show', mediaIds: ['m1'] },
    attempts: 0,
    resolution: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    resolvedAt: null,
    ...overrides,
  };
}

type Stubs = {
  openIdempotent: jest.Mock;
  get: jest.Mock;
  getOpenBySubject: jest.Mock;
  addEvent: jest.Mock;
  patchPayload: jest.Mock;
  incrementAttempts: jest.Mock;
  close: jest.Mock;
};

function buildStubs(ticket: TicketEntity | null = buildTicket()): Stubs {
  return {
    openIdempotent: jest.fn().mockResolvedValue({ ticket: buildTicket(), created: true }),
    get: jest.fn().mockResolvedValue(ticket),
    getOpenBySubject: jest.fn().mockResolvedValue(ticket),
    addEvent: jest.fn().mockResolvedValue({}),
    patchPayload: jest.fn().mockResolvedValue(undefined),
    incrementAttempts: jest.fn().mockResolvedValue(undefined),
    close: jest.fn().mockResolvedValue(true),
  };
}

function buildService(stubs: Stubs): TicketService {
  return new TicketService(stubs as unknown as TicketsRepository);
}

describe('TicketService', () => {
  describe('open', () => {
    it('records a created event only when the ticket is new', async () => {
      const stubs = buildStubs();
      const service = buildService(stubs);

      await service.open(
        TicketCategory.MissingImdb,
        { type: 'show', id: 'trakt:42' },
        { title: 'Silo', year: 2023, kind: 'show', mediaIds: ['m1'] },
        { title: 'IMDb inconnu — Silo' },
      );
      expect(stubs.addEvent).toHaveBeenCalledWith('t1', 'created', 'system', 'IMDb inconnu — Silo');

      stubs.addEvent.mockClear();
      stubs.openIdempotent.mockResolvedValue({ ticket: buildTicket(), created: false });
      await service.open(
        TicketCategory.MissingImdb,
        { type: 'show', id: 'trakt:42' },
        { title: 'Silo', year: 2023, kind: 'show', mediaIds: ['m1'] },
        { title: 'IMDb inconnu — Silo' },
      );
      expect(stubs.addEvent).not.toHaveBeenCalled();
    });
  });

  describe('applyOperation', () => {
    it('rejects operations on a closed ticket without reopening it', async () => {
      const stubs = buildStubs(buildTicket({ status: TicketStatus.Resolved }));
      const outcome = await buildService(stubs).applyOperation('t1', { kind: 'submitImdb', imdbId: 'tt1' }, 'a');

      expect(outcome.status).toBe('failed');
      expect(stubs.close).not.toHaveBeenCalled();
      expect(stubs.incrementAttempts).not.toHaveBeenCalled();
    });

    it('rejects operations the category does not accept', async () => {
      const stubs = buildStubs();
      const outcome = await buildService(stubs).applyOperation('t1', { kind: 'approve' }, 'a');

      expect(outcome.status).toBe('failed');
      expect(outcome.message).toContain('approve');
    });

    it('dispatches to the category handler and closes on resolved', async () => {
      const stubs = buildStubs();
      const service = buildService(stubs);
      service.registerHandler(TicketCategory.MissingImdb, async () => ({ status: 'resolved', message: 'ok' }));

      const outcome = await service.applyOperation('t1', { kind: 'submitImdb', imdbId: 'tt1' }, 'discord:u1');

      expect(outcome.status).toBe('resolved');
      expect(stubs.incrementAttempts).toHaveBeenCalledWith('t1');
      expect(stubs.close).toHaveBeenCalledWith('t1', TicketStatus.Resolved, 'ok');
      expect(stubs.addEvent).toHaveBeenCalledWith('t1', 'resolved', 'discord:u1', 'ok');
    });

    it('keeps the ticket open and records the failure on a failed attempt', async () => {
      const stubs = buildStubs();
      const service = buildService(stubs);
      service.registerHandler(TicketCategory.MissingImdb, async () => ({
        status: 'failed',
        message: 'boom',
        payloadPatch: { lastError: 'boom' },
      }));

      const outcome = await service.applyOperation('t1', { kind: 'submitImdb', imdbId: 'tt1' }, 'a');

      expect(outcome.status).toBe('failed');
      expect(stubs.close).not.toHaveBeenCalled();
      expect(stubs.patchPayload).toHaveBeenCalledWith('t1', { lastError: 'boom' });
      expect(stubs.addEvent).toHaveBeenCalledWith('t1', 'attempt-failed', 'a', 'boom');
    });

    it('turns a throwing handler into a failed outcome', async () => {
      const stubs = buildStubs();
      const service = buildService(stubs);
      service.registerHandler(TicketCategory.MissingImdb, async () => {
        throw new Error('kaput');
      });

      const outcome = await service.applyOperation('t1', { kind: 'submitImdb', imdbId: 'tt1' }, 'a');
      expect(outcome).toEqual<OperationOutcome>({
        status: 'failed',
        message: 'kaput',
        payloadPatch: { lastError: 'kaput' },
      });
      expect(stubs.close).not.toHaveBeenCalled();
    });

    it('resolves manually from the core without any handler', async () => {
      const stubs = buildStubs(buildTicket({ category: TicketCategory.PipelineFailure }));
      const outcome = await buildService(stubs).applyOperation('t1', { kind: 'resolveManually', note: 'fait' }, 'a');

      expect(outcome.status).toBe('resolved');
      expect(stubs.close).toHaveBeenCalledWith('t1', TicketStatus.Resolved, 'fait');
      expect(stubs.incrementAttempts).not.toHaveBeenCalled();
    });

    it('keeps progress outcomes open with a note', async () => {
      const stubs = buildStubs(buildTicket({ category: TicketCategory.DownloadAction }));
      const service = buildService(stubs);
      service.registerHandler(TicketCategory.DownloadAction, async () => ({
        status: 'progress',
        message: 'Téléchargement lancé',
      }));

      const outcome = await service.applyOperation('t1', { kind: 'submitLink', url: 'https://x' }, 'a');

      expect(outcome.status).toBe('progress');
      expect(stubs.close).not.toHaveBeenCalled();
      expect(stubs.addEvent).toHaveBeenCalledWith('t1', 'note', 'a', 'Téléchargement lancé');
    });
  });

  describe('resolveBySubject', () => {
    it('is a no-op when no open ticket matches', async () => {
      const stubs = buildStubs();
      stubs.getOpenBySubject.mockResolvedValue(null);

      await buildService(stubs).resolveBySubject(TicketCategory.DownloadAction, 'planned_download', 'a1', 'done');
      expect(stubs.close).not.toHaveBeenCalled();
    });

    it('closes the matching open ticket with the resolution', async () => {
      const stubs = buildStubs();
      await buildService(stubs).resolveBySubject(TicketCategory.DownloadAction, 'planned_download', 'a1', 'done');

      expect(stubs.close).toHaveBeenCalledWith('t1', TicketStatus.Resolved, 'done');
      expect(stubs.addEvent).toHaveBeenCalledWith('t1', 'resolved', 'system', 'done');
    });
  });
});
