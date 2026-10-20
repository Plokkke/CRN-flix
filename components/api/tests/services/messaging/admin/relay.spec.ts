import { AdminChannel, TicketView } from '@crn-flix/contracts';

import { TicketsRepository } from '@/services/database/tickets';
import { AdminTicketRelay } from '@/services/messaging/admin/relay';
import { TicketContextLoader } from '@/services/tickets/context';
import { TicketCategory, TicketEntity, TicketStatus } from '@/services/tickets/model';
import { TicketService } from '@/services/tickets/ticket.service';

const view: TicketView = { title: 'T', tone: 'info', fields: [], footer: null, operations: ['submitImdb'] };

jest.mock('@/services/tickets/presenter', () => ({ buildTicketView: () => view }));

const ticket = { id: 't1', status: TicketStatus.Open, category: TicketCategory.MissingImdb } as TicketEntity;

function build() {
  const channel = {
    name: 'discord',
    adminIds: ['admin'],
    start: jest.fn(),
    stop: jest.fn(),
    postTicket: jest.fn().mockResolvedValue('root-1'),
    adoptMessage: jest.fn().mockResolvedValue(undefined),
    updateTicket: jest.fn().mockResolvedValue(undefined),
    appendToTicket: jest.fn().mockResolvedValue(undefined),
    closeTicket: jest.fn().mockResolvedValue(undefined),
    acknowledge: jest.fn().mockResolvedValue(undefined),
    showDownloads: jest.fn(),
    purge: jest.fn().mockResolvedValue({ removed: 4, kept: 1 }),
    notifyAdmin: jest.fn(),
  };
  const tickets = {
    getBindings: jest.fn().mockResolvedValue([]),
    bind: jest.fn().mockResolvedValue(true),
    get: jest.fn().mockResolvedValue(ticket),
    getByBinding: jest.fn().mockResolvedValue(null),
    unbindAll: jest.fn().mockResolvedValue(2),
    unbind: jest.fn().mockResolvedValue(undefined),
  };
  const ticketService = {
    addAdminMessage: jest.fn().mockResolvedValue(undefined),
    applyOperation: jest.fn().mockResolvedValue({ status: 'resolved', message: 'ok' }),
    open: jest.fn().mockResolvedValue({ id: 'manual-1' }),
  };
  const relay = new AdminTicketRelay(
    channel as unknown as AdminChannel,
    tickets as unknown as TicketsRepository,
    ticketService as unknown as TicketService,
    { load: jest.fn().mockResolvedValue({}) } as unknown as TicketContextLoader,
  );
  return { relay, channel, tickets, ticketService };
}

const message = (overrides = {}) => ({
  ref: 'msg-1',
  ticketRef: null,
  inConversation: false,
  adminId: 'admin',
  content: '',
  ...overrides,
});

describe('AdminTicketRelay', () => {
  describe('materialize', () => {
    it('posts the ticket and binds its root under the channel name', async () => {
      const { relay, channel, tickets } = build();

      await relay.materialize(ticket);

      expect(channel.postTicket).toHaveBeenCalledWith(view);
      expect(tickets.bind).toHaveBeenCalledWith('t1', 'discord', 'root', 'root-1');
      expect(channel.closeTicket).not.toHaveBeenCalled();
    });

    it('takes its post back when another materialization won the binding race', async () => {
      const { relay, channel, tickets } = build();
      tickets.bind.mockResolvedValue(false);

      await relay.materialize(ticket);

      expect(channel.closeTicket).toHaveBeenCalledWith('root-1');
    });

    it('does nothing for a ticket already shown', async () => {
      const { relay, channel, tickets } = build();
      tickets.getBindings.mockResolvedValue([{ kind: 'root', externalId: 'root-0' }]);

      await relay.materialize(ticket);

      expect(channel.postTicket).not.toHaveBeenCalled();
    });
  });

  describe('message', () => {
    it('records the reply on its ticket and applies the operation it carries', async () => {
      const { relay, tickets, ticketService } = build();
      tickets.getByBinding.mockResolvedValue(ticket);

      const ack = await relay.message(message({ ticketRef: 'root-1', content: 'tt1234567' }));

      expect(ticketService.addAdminMessage).toHaveBeenCalledWith('t1', 'discord:admin', 'tt1234567', 'discord');
      expect(ticketService.applyOperation).toHaveBeenCalledWith(
        't1',
        { kind: 'submitImdb', imdbId: 'tt1234567' },
        'discord:admin',
      );
      expect(ack).toBe('succeeded');
    });

    it('opens a manual download for a link posted on its own, hanging off the admin message', async () => {
      const { relay, channel, tickets, ticketService } = build();

      const ack = await relay.message(message({ content: 'https://1fichier.com/?abc' }));

      expect(ticketService.open).toHaveBeenCalledWith(
        TicketCategory.ManualDownload,
        null,
        {
          url: 'https://1fichier.com/?abc',
        },
        expect.anything(),
      );
      expect(tickets.bind).toHaveBeenCalledWith('manual-1', 'discord', 'root', 'msg-1');
      expect(channel.adoptMessage).toHaveBeenCalledWith('msg-1', 'Téléchargement manuel');
      expect(ack).toBeNull();
    });

    it('ignores a link posted in a conversation that is not a ticket', async () => {
      const { relay, ticketService } = build();

      await relay.message(message({ ticketRef: 'thread-x', inConversation: true, content: 'https://dl.test/a' }));

      expect(ticketService.open).not.toHaveBeenCalled();
    });
  });

  describe('operation', () => {
    it('returns the refreshed view while the ticket stays open, null once closed', async () => {
      const { relay, tickets } = build();
      tickets.getByBinding.mockResolvedValue(ticket);

      await expect(relay.operation('root-1', { kind: 'approve' }, 'admin')).resolves.toBe(view);

      tickets.get.mockResolvedValue({ ...ticket, status: TicketStatus.Resolved });
      await expect(relay.operation('root-1', { kind: 'approve' }, 'admin')).resolves.toBeNull();
    });
  });

  describe('takeDown', () => {
    it('closes the ticket on the channel, then forgets it there', async () => {
      const { relay, channel, tickets } = build();
      tickets.getBindings.mockResolvedValue([{ kind: 'root', externalId: 'root-1' }]);

      await relay.takeDown('t1');

      expect(channel.closeTicket).toHaveBeenCalledWith('root-1');
      expect(tickets.unbind).toHaveBeenCalledWith('t1', 'discord');
    });

    it('keeps the binding when the channel could not close it, so the reconciler retries', async () => {
      const { relay, channel, tickets } = build();
      tickets.getBindings.mockResolvedValue([{ kind: 'root', externalId: 'root-1' }]);
      channel.closeTicket.mockRejectedValue(new Error('discord down'));

      await relay.takeDown('t1');

      expect(tickets.unbind).not.toHaveBeenCalled();
    });
  });

  it('re-renders the root of a shown ticket, and nothing for one never shown', async () => {
    const { relay, channel, tickets } = build();

    await relay.refresh(ticket);
    expect(channel.updateTicket).not.toHaveBeenCalled();

    tickets.getBindings.mockResolvedValue([{ kind: 'root', externalId: 'root-1' }]);
    await relay.refresh(ticket);
    expect(channel.updateTicket).toHaveBeenCalledWith('root-1', view);
  });

  it('purges the channel and forgets its bindings', async () => {
    const { relay, tickets } = build();

    await expect(relay.purge()).resolves.toEqual({ removed: 4, kept: 1 });
    expect(tickets.unbindAll).toHaveBeenCalledWith('discord');
  });
});
