import { Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';

import {
  AdminAcknowledgement,
  AdminChannel,
  AdminInbox,
  AdminMessage,
  PurgeReport,
  TicketOperation,
  TicketView,
} from '@crn-flix/contracts';

import { Listener } from '@/helpers/events';
import { TicketNotifyEvents, TicketsRepository } from '@/services/database/tickets';
import { TicketContextLoader } from '@/services/tickets/context';
import {
  TicketCategory,
  TicketEntity,
  TicketEventEntity,
  TicketEventKind,
  TicketStatus,
} from '@/services/tickets/model';
import { parseMessageOperation, parseSpontaneousUrl } from '@/services/tickets/parse';
import { buildTicketView } from '@/services/tickets/presenter';
import { TicketService } from '@/services/tickets/ticket.service';

const describeError = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/**
 * Keeps an admin channel in step with the tickets and turns what admins do there into ticket
 * operations. Holds no state of its own: everything lives in tickets/ticket_bindings, under
 * the channel's name as adapter (so existing bindings survive a restart or a purge+reconcile).
 */
export class AdminTicketRelay implements AdminInbox, OnModuleInit, OnModuleDestroy {
  private static readonly logger = new Logger(AdminTicketRelay.name);

  private listener: Listener<TicketNotifyEvents> | null = null;

  constructor(
    private readonly channel: AdminChannel,
    private readonly tickets: TicketsRepository,
    private readonly ticketService: TicketService,
    private readonly contextLoader: TicketContextLoader,
  ) {}

  get adapter(): string {
    return this.channel.name;
  }

  onModuleInit(): void {
    this.listener = this.tickets.listen({
      created: ({ ticketId }) => this.onTicketCreated(ticketId),
      eventCreated: ({ ticketId, eventId }) => this.onTicketEvent(ticketId, eventId),
      statusChange: ({ ticketId, newStatus }) => this.onTicketStatusChange(ticketId, newStatus),
    });
    this.channel.start(this);
  }

  onModuleDestroy(): void {
    this.listener?.cleanup();
    this.listener = null;
    this.channel.stop();
  }

  onChannelConnected(callback: () => void): () => void {
    return this.channel.onConnected(callback);
  }

  /** Wipes the channel and forgets every binding: the reconciler brings open tickets back. */
  async purge(): Promise<PurgeReport> {
    const report = await this.channel.purge();
    const unbound = await this.tickets.unbindAll(this.adapter);
    AdminTicketRelay.logger.log(`Admin channel purged (${report.removed} removed), ${unbound} binding(s) dropped`);
    return report;
  }

  // --- Outbound: ticket lifecycle → channel ---

  private async onTicketCreated(ticketId: string): Promise<void> {
    const ticket = await this.tickets.get(ticketId);
    if (ticket && ticket.status === TicketStatus.Open) {
      await this.materialize(ticket);
    }
  }

  /** Idempotent: the root binding arbitrates races with the reconciler and self-bound tickets. */
  async materialize(ticket: TicketEntity): Promise<void> {
    const bindings = await this.tickets.getBindings(ticket.id, this.adapter);
    if (bindings.some((binding) => binding.kind === 'root')) {
      return;
    }
    try {
      const rootRef = await this.channel.postTicket(await this.viewOf(ticket));
      if (!(await this.tickets.bind(ticket.id, this.adapter, 'root', rootRef))) {
        await this.channel.closeTicket(rootRef);
        return;
      }
      AdminTicketRelay.logger.log(`Materialized ticket ${ticket.id} as ${rootRef}`);
    } catch (error) {
      AdminTicketRelay.logger.error(`Failed to materialize ticket ${ticket.id}: ${describeError(error)}`);
    }
  }

  private async onTicketEvent(ticketId: string, eventId: string): Promise<void> {
    const [ticket, event] = await Promise.all([this.tickets.get(ticketId), this.tickets.getEvent(eventId)]);
    if (!ticket || !event || !this.shouldRenderEvent(event)) {
      return;
    }
    // A closed ticket's conversation is being deleted: posting there would recreate it.
    const rootRef = ticket.status === TicketStatus.Open ? await this.rootBinding(ticketId) : null;
    if (!rootRef) {
      return;
    }
    await this.channel
      .appendToTicket(rootRef, { kind: event.kind, message: event.message, actor: event.actor })
      .catch((error) => AdminTicketRelay.logger.error(`Failed to post in ticket ${ticketId}: ${describeError(error)}`));
    await this.channel
      .updateTicket(rootRef, await this.viewOf(ticket))
      .catch((error) => AdminTicketRelay.logger.error(`Failed to refresh ticket ${ticketId}: ${describeError(error)}`));
  }

  /** Skip what the admin already sees: their own messages and operations here, and the bootstrap. */
  private shouldRenderEvent(event: TicketEventEntity): boolean {
    if (event.kind === TicketEventKind.Created) {
      return false;
    }
    if (event.kind === TicketEventKind.AdminMessage && event.data.origin === this.adapter) {
      return false;
    }
    return !(event.kind === TicketEventKind.Operation && event.actor.startsWith(`${this.adapter}:`));
  }

  /** The channel only shows open tickets. */
  private async onTicketStatusChange(ticketId: string, newStatus: TicketStatus): Promise<void> {
    if (newStatus !== TicketStatus.Open) {
      await this.takeDown(ticketId);
    }
  }

  /** Removes a closed ticket from the channel, then forgets it there: a binding left behind marks a missed closing. */
  async takeDown(ticketId: string): Promise<void> {
    const rootRef = await this.rootBinding(ticketId);
    if (!rootRef) {
      return;
    }
    try {
      await this.channel.closeTicket(rootRef);
      await this.tickets.unbind(ticketId, this.adapter);
    } catch (error) {
      AdminTicketRelay.logger.error(`Failed to close ticket ${ticketId} (${rootRef}): ${describeError(error)}`);
    }
  }

  /** Re-renders the root of a shown ticket: updates may have been missed while the channel was down. */
  async refresh(ticket: TicketEntity): Promise<void> {
    const rootRef = await this.rootBinding(ticket.id);
    if (!rootRef) {
      return;
    }
    await this.channel
      .updateTicket(rootRef, await this.viewOf(ticket))
      .catch((error) =>
        AdminTicketRelay.logger.error(`Failed to refresh ticket ${ticket.id}: ${describeError(error)}`),
      );
  }

  // --- Inbound: channel → ticket operations ---

  async message(message: AdminMessage): Promise<AdminAcknowledgement> {
    const ticket = message.ticketRef ? await this.tickets.getByBinding(this.adapter, message.ticketRef) : null;
    if (ticket) {
      return this.handleTicketMessage(ticket, message);
    }
    // Spontaneous message with a link in the channel itself → manual download ticket.
    const url = message.inConversation ? null : parseSpontaneousUrl(message.content);
    if (url) {
      await this.openManualDownload(url, message.ref);
    }
    return null;
  }

  async operation(ticketRef: string, operation: TicketOperation, adminId: string): Promise<TicketView | null> {
    const ticket = await this.tickets.getByBinding(this.adapter, ticketRef);
    if (!ticket) {
      return null;
    }
    const outcome = await this.ticketService.applyOperation(ticket.id, operation, this.actorOf(adminId));
    if (outcome.status === 'failed') {
      AdminTicketRelay.logger.warn(`Operation ${operation.kind} on ticket ${ticket.id} failed: ${outcome.message}`);
    }
    const updated = await this.tickets.get(ticket.id);
    return updated?.status === TicketStatus.Open ? this.viewOf(updated) : null;
  }

  private async handleTicketMessage(ticket: TicketEntity, message: AdminMessage): Promise<AdminAcknowledgement> {
    const actor = this.actorOf(message.adminId);
    await this.ticketService.addAdminMessage(ticket.id, actor, message.content, this.adapter);

    const operation = parseMessageOperation(message.content, (await this.viewOf(ticket)).operations);
    if (!operation) {
      return null;
    }
    const outcome = await this.ticketService.applyOperation(ticket.id, operation, actor);
    return outcome.status === 'failed' ? 'failed' : 'succeeded';
  }

  private async openManualDownload(url: string, messageRef: string): Promise<void> {
    const ticket = await this.ticketService.open(
      TicketCategory.ManualDownload,
      null,
      { url },
      { title: `Téléchargement manuel — ${url.slice(0, 80)}` },
    );
    // Bind the admin's own message as root before the created-event listener materializes
    // a duplicate; the conversation hangs off their message.
    if (await this.tickets.bind(ticket.id, this.adapter, 'root', messageRef)) {
      try {
        await this.channel.adoptMessage(messageRef, 'Téléchargement manuel');
      } catch (error) {
        AdminTicketRelay.logger.error(`Failed to open the manual download ${ticket.id}: ${describeError(error)}`);
      }
    }
  }

  private actorOf(adminId: string): string {
    return `${this.adapter}:${adminId}`;
  }

  private async viewOf(ticket: TicketEntity): Promise<TicketView> {
    return buildTicketView(ticket, await this.contextLoader.load(ticket));
  }

  private async rootBinding(ticketId: string): Promise<string | null> {
    const bindings = await this.tickets.getBindings(ticketId, this.adapter);
    return bindings.find((binding) => binding.kind === 'root')?.externalId ?? null;
  }
}
