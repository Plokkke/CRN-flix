import {
  ButtonInteraction,
  Channel,
  Client,
  ClientEvents,
  DiscordAPIError,
  Events,
  GatewayIntentBits,
  GuildMember,
  Interaction,
  Message,
  MessageCreateOptions,
  MessageReaction,
  PartialMessageReaction,
  Partials,
  PartialUser,
  RESTJSONErrorCodes,
  Status,
  TextChannel,
  ThreadChannel,
  User,
} from 'discord.js';
import { z } from 'zod';

import { createLogger } from '@crn-flix/contracts';

export const discordConfigSchema = z.object({
  bot: z.object({
    token: z.string(),
  }),
});

export type DiscordConfig = z.infer<typeof discordConfigSchema>;

const LOGIN_RETRY_MIN_MS = 5_000;
const LOGIN_RETRY_MAX_MS = 5 * 60_000;

const MISSING_RESOURCE_CODES: readonly unknown[] = [
  RESTJSONErrorCodes.UnknownMessage,
  RESTJSONErrorCodes.UnknownChannel,
];

/** The message or channel no longer exists on Discord (deleted by hand, or already cleaned up). */
export function isMissingResource(error: unknown): boolean {
  return error instanceof DiscordAPIError && MISSING_RESOURCE_CODES.includes(error.code);
}

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

/**
 * One bot connection shared by every Discord plugin (admin channel, …): created once by the
 * engine, which also destroys it on shutdown. It connects in the background, retrying until
 * Discord accepts it, so the engine never waits for Discord to boot.
 */
export class DiscordService {
  private static readonly logger = createLogger(DiscordService.name);

  static create(config: DiscordConfig): DiscordService {
    const service = new DiscordService(config);
    void service.connect(LOGIN_RETRY_MIN_MS);
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

  static async startThread(message: Message, name: string): Promise<ThreadChannel> {
    return message.startThread({ name: name.slice(0, 100), autoArchiveDuration: 10080 });
  }

  static async sendInThread(channel: TextChannel, threadId: string, content: MessageCreateOptions): Promise<Message> {
    const thread = await this.getThread(channel, threadId);
    if (thread.archived) {
      await thread.setArchived(false);
    }
    return thread.send(content);
  }

  /** Deleting the starter message leaves the thread alive: it has to go on its own. */
  static async deleteThread(channel: TextChannel, threadId: string): Promise<void> {
    const thread = await this.getThread(channel, threadId);
    await thread.delete();
  }

  private readonly client: Client;
  private retryTimer: NodeJS.Timeout | null = null;

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
    this.client.once(Events.ClientReady, (client) =>
      DiscordService.logger.log(`Discord bot is connected as ${client.user.tag}`),
    );
  }

  async destroy(): Promise<void> {
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
    }
    await this.client.destroy();
  }

  /** The gateway is up: events flow in and messages can be sent. */
  isConnected(): boolean {
    return this.client.ws.status === Status.Ready;
  }

  /** Fired once connected, then after every reconnection: events of the outage were missed. */
  onConnected(callback: () => void): () => void {
    // `shardReady` also fires before the first `ready`, when the client is not usable yet.
    const reconnected = (): void => {
      if (this.client.isReady()) {
        return callback();
      }
    };
    const cleanups = [
      registerListener(this.client, Events.ClientReady, () => callback()),
      registerListener(this.client, Events.ShardReady, reconnected),
      registerListener(this.client, Events.ShardResume, reconnected),
    ];
    return () => cleanups.forEach((cleanup) => cleanup());
  }

  private async connect(retryMs: number): Promise<void> {
    try {
      await this.client.login(this.config.bot.token);
    } catch (error) {
      DiscordService.logger.error(
        `Discord login failed, retrying in ${retryMs / 1000}s: ${error instanceof Error ? error.message : error}`,
      );
      this.retryTimer = setTimeout(() => void this.connect(Math.min(retryMs * 2, LOGIN_RETRY_MAX_MS)), retryMs);
    }
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

  async sendDirectMessage(userId: string, content: string): Promise<void> {
    const user = await this.getUser(userId);
    await user.send(content);
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

  onGuildMessage(callback: (message: Message) => Promise<void> | void): () => void {
    return registerListener(this.client, Events.MessageCreate, (message: Message): void => {
      if (message.guild && !message.author.bot) {
        return callback(message) as void;
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

  onReactionRemove(
    callback: (userId: string, messageId: string, reaction: string) => Promise<void> | void,
  ): () => void {
    return registerListener(
      this.client,
      Events.MessageReactionRemove,
      async (reaction: MessageReaction | PartialMessageReaction, user: User | PartialUser): Promise<void> => {
        DiscordService.logger.debug(
          `Reaction ${reaction.emoji.name} removed by ${user.id} from message ${reaction.message.id}`,
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

  onButtonInteraction(callback: (interaction: ButtonInteraction) => Promise<void> | void): () => void {
    return registerListener(this.client, Events.InteractionCreate, (interaction: Interaction): void => {
      if (interaction.isButton() && !interaction.user.bot) {
        return callback(interaction) as void;
      }
    });
  }
}
