import { TicketsRepository } from '@/services/database/tickets';
import { IntegrationMonitor } from '@/services/integrations/monitor';
import { TicketCategory } from '@/services/tickets/model';
import { TicketService } from '@/services/tickets/ticket.service';

const HOUR = 60 * 60 * 1000;
const incompatible = (): Error => Object.assign(new Error('Expected number, received string'), { name: 'ZodError' });
const unavailable = (): Error => Object.assign(new Error('timeout'), { response: { status: 503 } });

function build(openTickets: unknown[] = []) {
  let now = 0;
  const tickets = { listOpen: jest.fn().mockResolvedValue(openTickets) };
  const ticketService = {
    open: jest.fn().mockResolvedValue({ id: 'ticket-1' }),
    recordSystemEvent: jest.fn().mockResolvedValue(undefined),
    resolveById: jest.fn().mockResolvedValue(undefined),
  };
  const monitor = new IntegrationMonitor(
    tickets as unknown as TicketsRepository,
    ticketService as unknown as TicketService,
    () => now,
  );
  return { monitor, ticketService, advance: (ms: number) => (now += ms) };
}

describe('IntegrationMonitor', () => {
  it('opens one ticket per integration call that stops matching its API, and rethrows', async () => {
    const { monitor, ticketService } = build();
    const run = () => Promise.reject(incompatible());

    await expect(monitor.track('trakt', 'playhead', run)).rejects.toThrow('Expected number');
    await expect(monitor.track('trakt', 'playhead', run)).rejects.toThrow();

    expect(ticketService.open).toHaveBeenCalledTimes(1);
    expect(ticketService.open).toHaveBeenCalledWith(
      TicketCategory.IntegrationFailure,
      { type: 'integration', id: 'trakt:playhead' },
      expect.objectContaining({ integration: 'trakt', operation: 'playhead' }),
      expect.objectContaining({ title: 'trakt — playhead incompatible' }),
    );
  });

  it('leaves an unavailable integration to the logs', async () => {
    const { monitor, ticketService } = build();

    await expect(monitor.track('loadix', 'find', () => Promise.reject(unavailable()))).rejects.toThrow('timeout');

    expect(ticketService.open).not.toHaveBeenCalled();
  });

  it('notes a lasting incompatibility at most once an hour', async () => {
    const { monitor, ticketService, advance } = build();

    await monitor.failed('loadix', 'find', incompatible());
    advance(HOUR / 2);
    await monitor.failed('loadix', 'find', incompatible());
    advance(HOUR);
    await monitor.failed('loadix', 'find', incompatible());

    expect(ticketService.recordSystemEvent).toHaveBeenCalledTimes(1);
    expect(ticketService.recordSystemEvent).toHaveBeenCalledWith('ticket-1', expect.stringContaining('Toujours'));
  });

  it('resolves only once the call kept working for an hour', async () => {
    const { monitor, ticketService, advance } = build();
    await monitor.failed('loadix', 'find', incompatible());

    advance(HOUR / 2);
    await monitor.track('loadix', 'find', () => Promise.resolve([]));
    expect(ticketService.resolveById).not.toHaveBeenCalled();

    advance(HOUR);
    await monitor.track('loadix', 'find', () => Promise.resolve([]));
    await monitor.track('loadix', 'find', () => Promise.resolve([]));
    expect(ticketService.resolveById).toHaveBeenCalledTimes(1);
    expect(ticketService.resolveById).toHaveBeenCalledWith('ticket-1', expect.any(String));
  });

  it('picks up the tickets left open by a previous run', async () => {
    const { monitor, ticketService, advance } = build([
      { id: 'old', category: TicketCategory.IntegrationFailure, subjectId: 'trakt:playhead', updatedAt: new Date(0) },
      { id: 'other', category: TicketCategory.MissingImdb, subjectId: 'x', updatedAt: new Date(0) },
    ]);
    await monitor.onModuleInit();

    advance(2 * HOUR);
    await monitor.succeeded('trakt', 'playhead');

    expect(ticketService.resolveById).toHaveBeenCalledWith('old', expect.any(String));
  });

  it('opens a new ticket when the admin closed the previous one while it still fails', async () => {
    const { monitor, ticketService, advance } = build();
    await monitor.failed('trakt', 'playhead', incompatible());
    ticketService.open.mockResolvedValue({ id: 'ticket-2' });

    advance(HOUR);
    await monitor.failed('trakt', 'playhead', incompatible());

    expect(ticketService.open).toHaveBeenCalledTimes(2);
    expect(ticketService.recordSystemEvent).not.toHaveBeenCalled();
  });
});
