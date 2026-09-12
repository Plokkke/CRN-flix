import { Logger } from '@nestjs/common';
import { ChannelType, Message, MessageCreateOptions, TextChannel } from 'discord.js';

import { DiscordService } from '@/modules/discord/discord';

export type AdminChannelConfig = {
  channelId: string;
  adminIds: string[];
};

/** The single admin text channel plus the low-level message helpers every consumer shares. */
export class DiscordAdminChannel {
  private static readonly logger = new Logger(DiscordAdminChannel.name);

  static async create(config: AdminChannelConfig, discordService: DiscordService): Promise<DiscordAdminChannel> {
    const channel = await discordService.getChannel(config.channelId);
    if (channel.type !== ChannelType.GuildText) {
      throw new Error(`Channel with ID ${config.channelId} is not a text channel`);
    }
    return new DiscordAdminChannel(config, discordService, channel as TextChannel);
  }

  private constructor(
    readonly config: AdminChannelConfig,
    readonly discordService: DiscordService,
    readonly channel: TextChannel,
  ) {}

  isAdmin(userId: string): boolean {
    return this.config.adminIds.includes(userId);
  }

  /** Main channel or one of its threads (a thread shares the id of its starter message). */
  isAdminChannelMessage(message: Message): boolean {
    if (message.channelId === this.config.channelId) {
      return true;
    }
    return message.channel.isThread() && message.channel.parentId === this.config.channelId;
  }

  async send(options: MessageCreateOptions): Promise<Message> {
    return this.channel.send(options);
  }

  async react(messageId: string, emoji: string): Promise<void> {
    try {
      const message = await DiscordService.getMessage(this.channel, messageId);
      await message.react(emoji);
    } catch (error) {
      DiscordAdminChannel.logger.error(
        `Failed to react to message ${messageId}: ${error instanceof Error ? error.message : error}`,
      );
    }
  }
}
