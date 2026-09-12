import { Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ButtonInteraction, Message } from 'discord.js';

import { Listener } from '@/helpers/events';
import { DiscordService } from '@/modules/discord/discord';
import { TicketNotifyEvents, TicketsRepository } from '@/services/database/tickets';
import { TicketContextLoader } from '@/services/tickets/context';
import {
  OperationOutcome,
  TicketCategory,
  TicketEntity,
  TicketEventEntity,
  TicketEventKind,
  TicketStatus,
} from '@/services/tickets/model';
import { buildTicketView } from '@/services/tickets/presenter';
import { TicketService } from '@/services/tickets/ticket.service';

import { DiscordAdminChannel } from './channel';
import { buildTicketButtons, buildTicketEmbed, formatEventLine } from './embeds';
import { parseButtonOperation, parseMessageOperation, parseSpontaneousUrl } from './parse';

export const DISCORD_ADAPTER = 'discord';

/**
 * Renders tickets in the admin channel (root embed + attached thread) and translates admin
 * interactions (replies, thread messages, buttons) into ticket operations. Holds no state of
 * its own: everything lives in tickets/ticket_bindings.
 *
 * A Discord thread started from a message shares that message's id, so the `root` binding
 * resolves both replies to the embed and messages posted inside the thread.
 */
export class DiscordTicketAdapter implements OnModuleInit, OnModuleDestroy {
  private static readonly logger = new Logger(DiscordTicketAdapter.name);

  private listener: Listener<TicketNotifyEvents> | null = null;
  private inboundCleanups: (() => void)[] = [];

  constructor(
    private readonly adminChannel: DiscordAdminChannel,
    private readonly tickets: TicketsRepository,
    private readonly ticketService: TicketService,
    private readonly contextLoader: TicketContextLoader,
  ) {}

  onModuleInit(): void {
    this.listener = this.tickets.listen({
      created: ({ ticketId }) => this.onTicketCreated(ticketId),
      eventCreated: ({ ticketId, eventId }) => this.onTicketEvent(ticketId, eventId),
      statusChange: ({ ticketId, newStatus }) => this.onTicketStatusChange(ticketId, newStatus),
    });

    this.inboundCleanups.push(
      this.adminChannel.discordService.onGuildMessage((message) => this.onInboundMessage(message)),
      this.adminChannel.discordService.onButtonInteraction((interaction) => this.onButton(interaction)),
    );
  }

  onModuleDestroy(): void {
    this.listener?.cleanup();
    this.listener = null;
    this.inboundCleanups.forEach((cleanup) => cleanup());
    this.inboundCleanups = [];
  }

  // --- Outbound: ticket lifecycle → Discord ---

  private async onTicketCreated(ticketId: string): Promise<void> {
    const ticket = await this.tickets.get(ticketId);
    if (ticket && ticket.status === TicketStatus.Open) {
      await this.materialize(ticket);
    }
  }

  /** Idempotent: the root binding arbitrates races with the reconciler and self-bound tickets. */
  async materialize(ticket: TicketEntity): Promise<void> {
    const bindings = await this.tickets.getBindings(ticket.id, DISCORD_ADAPTER);
    if (bindings.some((binding) => binding.kind === 'root')) {
      return;
    }

    try {
      const view = buildTicketView(ticket, await this.contextLoader.load(ticket));
      const message = await this.adminChannel.send({
        embeds: [buildTicketEmbed(view)],
        components: buildTicketButtons(view),
      });

      if (!(await this.tickets.bind(ticket.id, DISCORD_ADAPTER, 'root', message.id))) {
        await message.delete();
        return;
      }
      await DiscordService.startThread(message, view.title);
      DiscordTicketAdapter.logger.log(`Materialized ticket ${ticket.id} as message ${message.id}`);
    } catch (error) {
      DiscordTicketAdapter.logger.error(
        `Failed to materialize ticket ${ticket.id}: ${error instanceof Error ? error.message : error}`,
      );
    }
  }

  private async onTicketEvent(ticketId: string, eventId: string): Promise<void> {
    const [ticket, event] = await Promise.all([this.tickets.get(ticketId), this.tickets.getEvent(eventId)]);
    if (!ticket || !event || !this.shouldRenderEvent(event)) {
      return;
    }

    const rootId = await this.rootBinding(ticketId);
    if (!rootId) {
      return;
    }

    await this.postInThread(rootId, formatEventLine(event));
    if (ticket.status === TicketStatus.Open) {
      await this.refreshRootEmbed(ticket, rootId);
    }
  }

  /** Skip what the admin already sees: their own thread messages and the created bootstrap. */
  private shouldRenderEvent(event: TicketEventEntity): boolean {
    if (event.kind === TicketEventKind.Created) {
      return false;
    }
    if (event.kind === TicketEventKind.AdminMessage && event.data.origin === DISCORD_ADAPTER) {
      return false;
    }
    return !(event.kind === TicketEventKind.Operation && event.actor.startsWith(`${DISCORD_ADAPTER}:`));
  }

  private async onTicketStatusChange(ticketId: string, newStatus: TicketStatus): Promise<void> {
    if (newStatus === TicketStatus.Open) {
      return;
    }
    const rootId = await this.rootBinding(ticketId);
    if (!rootId) {
      return;
    }

    try {
      await DiscordService.setThreadArchived(this.adminChannel.channel, rootId, true);
    } catch {
      // No thread was ever created — nothing to archive.
    }

    // The channel only shows open tickets; a manual-download root is the admin's own
    // message and stays (deleting another author's message would be rude).
    const ticket = await this.tickets.get(ticketId);
    if (ticket?.category === TicketCategory.ManualDownload) {
      return;
    }
    try {
      const message = await DiscordService.getMessage(this.adminChannel.channel, rootId);
      await message.delete();
    } catch (error) {
      DiscordTicketAdapter.logger.error(
        `Failed to delete resolved ticket message ${rootId}: ${error instanceof Error ? error.message : error}`,
      );
    }
  }

  private async refreshRootEmbed(ticket: TicketEntity, rootId: string): Promise<void> {
    try {
      const message = await DiscordService.getMessage(this.adminChannel.channel, rootId);
      if (message.author.id !== this.adminChannel.channel.client.user.id) {
        return; // manual-download root owned by the admin — nothing to edit
      }
      const view = buildTicketView(ticket, await this.contextLoader.load(ticket));
      await message.edit({ embeds: [buildTicketEmbed(view)], components: buildTicketButtons(view) });
    } catch (error) {
      DiscordTicketAdapter.logger.error(
        `Failed to refresh ticket embed ${rootId}: ${error instanceof Error ? error.message : error}`,
      );
    }
  }

  private async postInThread(rootId: string, content: string): Promise<void> {
    try {
      await DiscordService.sendInThread(this.adminChannel.channel, rootId, { content });
    } catch {
      // Thread missing (crash between send and startThread): recreate it from the root.
      try {
        const message = await DiscordService.getMessage(this.adminChannel.channel, rootId);
        const thread = await DiscordService.startThread(message, 'ticket');
        await thread.send({ content });
      } catch (error) {
        DiscordTicketAdapter.logger.error(
          `Failed to post in ticket thread ${rootId}: ${error instanceof Error ? error.message : error}`,
        );
      }
    }
  }

  private async rootBinding(ticketId: string): Promise<string | null> {
    const bindings = await this.tickets.getBindings(ticketId, DISCORD_ADAPTER);
    return bindings.find((binding) => binding.kind === 'root')?.externalId ?? null;
  }

  // --- Inbound: Discord → ticket operations ---

  private async onInboundMessage(message: Message): Promise<void> {
    if (!this.adminChannel.isAdminChannelMessage(message) || !this.adminChannel.isAdmin(message.author.id)) {
      return;
    }

    const ticket = await this.resolveTicket(message);
    if (ticket) {
      await this.handleTicketMessage(ticket, message);
      return;
    }

    // Spontaneous message with a link in the main channel → manual download ticket.
    const url = message.channelId === this.adminChannel.config.channelId ? parseSpontaneousUrl(message.content) : null;
    if (url) {
      await this.openManualDownload(url, message);
    }
  }

  private async resolveTicket(message: Message): Promise<TicketEntity | null> {
    if (message.channel.isThread()) {
      return this.tickets.getByBinding(DISCORD_ADAPTER, message.channelId);
    }
    if (message.reference?.messageId) {
      return this.tickets.getByBinding(DISCORD_ADAPTER, message.reference.messageId);
    }
    return null;
  }

  private async handleTicketMessage(ticket: TicketEntity, message: Message): Promise<void> {
    const actor = `${DISCORD_ADAPTER}:${message.author.id}`;
    await this.ticketService.addAdminMessage(ticket.id, actor, message.content, DISCORD_ADAPTER);

    const view = buildTicketView(ticket, await this.contextLoader.load(ticket));
    const operation = parseMessageOperation(message.content, view.operations);
    if (!operation) {
      return;
    }

    const outcome = await this.ticketService.applyOperation(ticket.id, operation, actor);
    await this.adminChannel.react(message.id, outcome.status === 'failed' ? '❌' : '✅');
  }

  private async openManualDownload(url: string, message: Message): Promise<void> {
    const ticket = await this.ticketService.open(
      TicketCategory.ManualDownload,
      null,
      { url },
      { title: `Téléchargement manuel — ${url.slice(0, 80)}` },
    );

    // Bind the admin's own message as root before the created-event listener materializes
    // a duplicate embed; the thread hangs off their message.
    if (await this.tickets.bind(ticket.id, DISCORD_ADAPTER, 'root', message.id)) {
      try {
        await DiscordService.startThread(message, `Téléchargement manuel`);
      } catch (error) {
        DiscordTicketAdapter.logger.error(
          `Failed to start thread on manual download ${ticket.id}: ${error instanceof Error ? error.message : error}`,
        );
      }
    }
  }

  private async onButton(interaction: ButtonInteraction): Promise<void> {
    if (interaction.channelId !== this.adminChannel.config.channelId) {
      return;
    }
    if (!this.adminChannel.isAdmin(interaction.user.id)) {
      return;
    }

    const ticket = await this.tickets.getByBinding(DISCORD_ADAPTER, interaction.message.id);
    const operation = parseButtonOperation(interaction.customId);
    if (!ticket || !operation) {
      return;
    }

    const outcome = await this.ticketService.applyOperation(
      ticket.id,
      operation,
      `${DISCORD_ADAPTER}:${interaction.user.id}`,
    );
    await this.settleInteraction(interaction, ticket.id, outcome);
  }

  private async settleInteraction(
    interaction: ButtonInteraction,
    ticketId: string,
    outcome: OperationOutcome,
  ): Promise<void> {
    try {
      const updated = await this.tickets.get(ticketId);
      if (!updated || updated.status !== TicketStatus.Open) {
        await interaction.deferUpdate(); // deletion/archival handled by the status listener
        return;
      }
      const view = buildTicketView(updated, await this.contextLoader.load(updated));
      await interaction.update({ embeds: [buildTicketEmbed(view)], components: buildTicketButtons(view) });
      if (outcome.status === 'failed') {
        DiscordTicketAdapter.logger.warn(`Button operation on ticket ${ticketId} failed: ${outcome.message}`);
      }
    } catch (error) {
      DiscordTicketAdapter.logger.error(
        `Failed to settle button interaction on ticket ${ticketId}: ${error instanceof Error ? error.message : error}`,
      );
    }
  }
}
