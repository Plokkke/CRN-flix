import { TicketsRepository } from '@/services/database/tickets';
import { AdminTicketRelay } from '@/services/messaging/admin/relay';
import { TicketEntity, TicketStatus } from '@/services/tickets/model';
import { TicketReconcilerService } from '@/services/tickets/reconciler';

const ticket = (id: string, status = TicketStatus.Open) => ({ id, status }) as TicketEntity;

function build() {
  let connected: () => void = () => undefined;
  const relay = {
    adapter: 'discord',
    materialize: jest.fn().mockResolvedValue(undefined),
    refresh: jest.fn().mockResolvedValue(undefined),
    takeDown: jest.fn().mockResolvedValue(undefined),
    onChannelConnected: jest.fn((callback: () => void) => {
      connected = callback;
      return jest.fn();
    }),
  };
  const tickets = {
    findOpenWithoutBinding: jest.fn().mockResolvedValue([ticket('unbound')]),
    findBound: jest.fn((_adapter: string, _kind: string, open: boolean) =>
      Promise.resolve(open ? [ticket('shown')] : [ticket('closed', TicketStatus.Resolved)]),
    ),
  };
  const reconciler = new TicketReconcilerService(
    tickets as unknown as TicketsRepository,
    relay as unknown as AdminTicketRelay,
  );
  return { reconciler, relay, tickets, connect: () => connected() };
}

describe('TicketReconcilerService', () => {
  it('shows the open tickets the channel lost and takes down the closed ones it still shows', async () => {
    const { reconciler, relay, tickets } = build();

    await reconciler.sync();

    expect(tickets.findOpenWithoutBinding).toHaveBeenCalledWith('discord', 'root', expect.any(Date));
    expect(relay.materialize).toHaveBeenCalledWith(ticket('unbound'));
    expect(relay.takeDown).toHaveBeenCalledWith('closed');
    expect(relay.refresh).not.toHaveBeenCalled();
  });

  it('on every (re)connection also re-renders the open tickets the channel shows', async () => {
    const { reconciler, relay, connect } = build();
    const recovered = new Promise<void>((resolve) => relay.takeDown.mockImplementation(async () => resolve()));
    reconciler.onModuleInit();

    connect();
    await recovered;

    expect(relay.refresh).toHaveBeenCalledWith(ticket('shown'));
    expect(relay.materialize).toHaveBeenCalledWith(ticket('unbound'));
    expect(relay.takeDown).toHaveBeenCalledWith('closed');
  });
});
