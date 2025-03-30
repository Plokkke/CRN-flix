import { Logger, OnModuleDestroy } from '@nestjs/common';
import {
  Channel,
  Client,
  Events,
  GatewayIntentBits,
  GuildMember,
  Message,
  MessageReaction,
  Partials,
  TextChannel,
  ThreadChannel,
  User,
  ClientEvents,
  PartialMessageReaction,
  PartialUser,
} from 'discord.js';
import { z } from 'zod';

export type MediaReactionEvent = {
  mediaId: string;
  reactionName: string;
  userId: string;
  messageId: string;
  channelId: string;
};

export type MediaMessageEvent = {
  mediaId: string;
  content: string;
  userId: string;
  messageId: string;
  channelId: string;
  threadId: string;
};

export const discordConfigSchema = z.object({
  bot: z.object({
    token: z.string(),
  }),
});

export type DiscordConfig = z.infer<typeof discordConfigSchema>;

function registerListener<Event extends keyof ClientEvents>(
  client: Client,
  event: Event,
  listener: (...args: ClientEvents[Event]) => void,
): () => void | Promise<void> {
  client.on(event, listener);
  return () => {
    client.off(event, listener);
  };
}

export class DiscordService implements OnModuleDestroy {
  private static readonly logger = new Logger(DiscordService.name);

  static async create(config: DiscordConfig): Promise<DiscordService> {
    const service = new DiscordService(config);

    await service.login();

    return service;
  }

  static async getMessage(channel: TextChannel, messageId: string): Promise<Message> {
    const message = await channel.messages.fetch(messageId);
    if (!message) {
      throw new Error(`Message with ID ${messageId} not found`);
    }
    return message;
  }

  static async getThread(channel: TextChannel, threadId: string): Promise<ThreadChannel> {
    const thread = await channel.threads.fetch(threadId);
    if (!thread) {
      throw new Error(`Thread with ID ${threadId} not found`);
    }
    return thread;
  }

  static async getHeadOfThread(channel: TextChannel, threadId: string): Promise<Message> {
    const thread = await this.getThread(channel, threadId);
    const message = await thread.fetchStarterMessage();
    if (!message) {
      throw new Error(`Message with ID ${threadId} not found`);
    }
    return message;
  }

  private readonly client: Client;

  private constructor(private config: DiscordConfig) {
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.MessageContent,
      ],
      partials: [Partials.Message, Partials.Channel, Partials.Reaction],
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.destroy();
  }

  private async login(): Promise<void> {
    await new Promise<void>(async (resolve) => {
      this.client.once('ready', () => {
        DiscordService.logger.log(`Discord bot is connected as ${this.client.user?.tag}`);
        resolve();
      });

      await this.client.login(this.config.bot.token);
    });
  }

  async getChannel(channelId: string): Promise<Channel> {
    const channel = await this.client.channels.fetch(channelId);
    if (!channel) {
      throw new Error(`Channel with ID ${channelId} not found`);
    }
    return channel;
  }

  async getUser(userId: string): Promise<User> {
    const user = await this.client.users.fetch(userId);
    if (!user) {
      throw new Error(`User with ID ${userId} not found`);
    }
    return user;
  }

  onDirectMessage(callback: (message: Message) => Promise<void> | void): () => void {
    return registerListener(this.client, Events.MessageCreate, (message: Message): void => {
      if (!message.guild && !message.author.bot) {
        callback(message);
        return;
      }
    });
  }

  onGuildMemberJoin(callback: (member: GuildMember) => Promise<void> | void): () => void {
    return registerListener(this.client, Events.GuildMemberAdd, (member: GuildMember): void => {
      if (member.guild) {
        callback(member);
        return;
      }
    });
  }

  onReaction(callback: (userId: string, messageId: string, reaction: string) => Promise<void> | void): () => void {
    return registerListener(
      this.client,
      Events.MessageReactionAdd,
      async (reaction: MessageReaction | PartialMessageReaction, user: User | PartialUser): Promise<void> => {
        DiscordService.logger.debug(
          `Reaction ${reaction.emoji.name} added by ${user.id} to message ${reaction.message.id}`,
        );
        if (user.bot) {
          return;
        }

        const message = reaction.message;
        if (!message.guild) {
          return;
        }

        callback(user.id, message.id, reaction.emoji.name!);
      },
    );
  }
}
