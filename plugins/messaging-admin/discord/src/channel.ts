import { ButtonInteraction, ChannelType, Message, MessageFlags, TextChannel } from 'discord.js';

import {
  AdminChannel,
  AdminInbox,
  createLogger,
  DownloadsBoardView,
  PurgeReport,
  TicketTimelineEntry,
  TicketView,
} from '@crn-flix/contracts';
import { DiscordService } from '@crn-flix/discord';

import { parseButtonOperation } from './buttons';
import {
  buildDownloadsEmbed,
  buildTicketButtons,
  buildTicketEmbed,
  DOWNLOADS_TITLE,
  formatTimelineEntry,
} from './embeds';
import { purgeChannel } from './purge';

export type DiscordAdminChannelConfig = {
  channelId: string;
  adminIds: string[];
};

const describeError = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/**
 * Tickets live in one admin text channel: a root embed with buttons and a thread attached to
 * it. A thread started from a message shares that message's id, so the root ref resolves
 * both replies to the embed and messages posted inside the thread.
 */
export class DiscordAdminChannel implements AdminChannel {
  private static readonly logger = createLogger(DiscordAdminChannel.name);

  readonly name = 'discord';

  private cleanups: (() => void)[] = [];
  private downloadsMessage: Message | null = null;

  static async create(config: DiscordAdminChannelConfig, discord: DiscordService): Promise<DiscordAdminChannel> {
    const channel = await discord.getChannel(config.channelId);
    if (channel.type !== ChannelType.GuildText) {
      throw new Error(`Channel with ID ${config.channelId} is not a text channel`);
    }
    return new DiscordAdminChannel(config, discord, channel as TextChannel);
  }

  private constructor(
    private readonly config: DiscordAdminChannelConfig,
    private readonly discord: DiscordService,
    private readonly channel: TextChannel,
  ) {}

  get adminIds(): readonly string[] {
    return this.config.adminIds;
  }

  start(inbox: AdminInbox): void {
    this.cleanups.push(
      this.discord.onGuildMessage((message) => this.onMessage(inbox, message)),
      this.discord.onButtonInteraction((interaction) => this.onButton(inbox, interaction)),
    );
  }

  stop(): void {
    this.cleanups.forEach((cleanup) => cleanup());
    this.cleanups = [];
  }

  async postTicket(view: TicketView): Promise<string> {
    const message = await this.channel.send({ embeds: [buildTicketEmbed(view)], components: buildTicketButtons(view) });
    await DiscordService.startThread(message, view.title);
    return message.id;
  }

  async adoptMessage(ref: string, title: string): Promise<void> {
    await DiscordService.startThread(await DiscordService.getMessage(this.channel, ref), title);
  }

  async updateTicket(rootRef: string, view: TicketView): Promise<void> {
    const message = await DiscordService.getMessage(this.channel, rootRef);
    if (this.isOwn(message)) {
      await message.edit({ embeds: [buildTicketEmbed(view)], components: buildTicketButtons(view) });
    }
  }

  async appendToTicket(rootRef: string, entry: TicketTimelineEntry): Promise<void> {
    const content = formatTimelineEntry(entry);
    try {
      await DiscordService.sendInThread(this.channel, rootRef, { content });
    } catch {
      // Thread missing (crash between send and startThread): recreate it from the root.
      const thread = await DiscordService.startThread(await DiscordService.getMessage(this.channel, rootRef), 'ticket');
      await thread.send({ content });
    }
  }

  /** The thread always goes; the root too, unless it is the admin's own message (a manual link). */
  async closeTicket(rootRef: string): Promise<void> {
    try {
      await DiscordService.deleteThread(this.channel, rootRef);
    } catch {
      // No thread was ever created (or already gone) — nothing to delete.
    }
    const message = await DiscordService.getMessage(this.channel, rootRef);
    if (this.isOwn(message)) {
      await message.delete();
    }
  }

  async acknowledge(ref: string, outcome: 'succeeded' | 'failed'): Promise<void> {
    try {
      await (await DiscordService.getMessage(this.channel, ref)).react(outcome === 'failed' ? '❌' : '✅');
    } catch (error) {
      DiscordAdminChannel.logger.error(`Failed to react to message ${ref}: ${describeError(error)}`);
    }
  }

  /**
   * Rewrites the single pinned progress message. Editing never notifies on Discord, so this
   * can run on a timer without ever pinging the admins on mobile.
   */
  async showDownloads(board: DownloadsBoardView): Promise<void> {
    try {
      await (await this.resolveDownloadsMessage()).edit({ embeds: [buildDownloadsEmbed(board)] });
    } catch (error) {
      // The message was most likely deleted by hand; drop the cache and rebuild it next tick.
      this.downloadsMessage = null;
      DiscordAdminChannel.logger.error(`Failed to refresh the downloads message: ${describeError(error)}`);
    }
  }

  async purge(): Promise<PurgeReport> {
    const { threads, messages, kept } = await purgeChannel(this.channel);
    return { removed: threads + messages, kept };
  }

  notifyAdmin(adminId: string, text: string): Promise<void> {
    return this.discord.sendDirectMessage(adminId, text);
  }

  private isOwn(message: Message): boolean {
    return message.author.id === this.channel.client.user.id;
  }

  private isAdmin(userId: string): boolean {
    return this.config.adminIds.includes(userId);
  }

  /** Main channel or one of its threads. */
  private isInChannel(message: Message): boolean {
    if (message.channelId === this.config.channelId) {
      return true;
    }
    return message.channel.isThread() && message.channel.parentId === this.config.channelId;
  }

  private async onMessage(inbox: AdminInbox, message: Message): Promise<void> {
    if (!this.isInChannel(message) || !this.isAdmin(message.author.id)) {
      return;
    }
    const inConversation = message.channel.isThread();
    const outcome = await inbox.message({
      ref: message.id,
      ticketRef: inConversation ? message.channelId : (message.reference?.messageId ?? null),
      inConversation,
      adminId: message.author.id,
      content: message.content,
    });
    if (outcome) {
      await this.acknowledge(message.id, outcome);
    }
  }

  private async onButton(inbox: AdminInbox, interaction: ButtonInteraction): Promise<void> {
    if (interaction.channelId !== this.config.channelId || !this.isAdmin(interaction.user.id)) {
      return;
    }
    const operation = parseButtonOperation(interaction.customId);
    if (!operation) {
      return;
    }
    try {
      const view = await inbox.operation(interaction.message.id, operation, interaction.user.id);
      if (view) {
        await interaction.update({ embeds: [buildTicketEmbed(view)], components: buildTicketButtons(view) });
      } else {
        await interaction.deferUpdate(); // deletion handled when the ticket closes
      }
    } catch (error) {
      DiscordAdminChannel.logger.error(`Failed to settle button ${interaction.customId}: ${describeError(error)}`);
    }
  }

  private async resolveDownloadsMessage(): Promise<Message> {
    if (this.downloadsMessage) {
      return this.downloadsMessage;
    }
    const { items } = await this.channel.messages.fetchPins();
    const existing = items.find(
      ({ message }) => this.isOwn(message) && !!message.embeds[0]?.title?.startsWith(DOWNLOADS_TITLE),
    )?.message;
    this.downloadsMessage = existing ?? (await this.createDownloadsMessage());
    return this.downloadsMessage;
  }

  private async createDownloadsMessage(): Promise<Message> {
    const message = await this.channel.send({
      embeds: [buildDownloadsEmbed({ active: 0, entries: [], hidden: 0 })],
      flags: MessageFlags.SuppressNotifications,
    });
    try {
      await message.pin();
    } catch (error) {
      DiscordAdminChannel.logger.warn(
        `Downloads message created but could not be pinned (ManageMessages permission?): ${describeError(error)}`,
      );
    }
    DiscordAdminChannel.logger.log(`Downloads progress message created (${message.id})`);
    return message;
  }
}
