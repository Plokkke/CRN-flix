import { Logger, OnModuleInit } from '@nestjs/common';
import { ChannelType, EmbedBuilder, TextChannel } from 'discord.js';
import * as _ from 'lodash';

import { Emitter } from '@/helpers/events';
import { UserEntity, UsersRepository } from '@/services/database/users';
import { DiscordService } from '@/services/discord';

export type Config = {
  channelId: string;
  adminIds: string[];
};

const USER_EVENT_BY_REACTION = {
  '✅': 'userAccepted',
  '❌': 'userRejected',
} as const;

export type AdminUserRejectedEvent = {
  user: UserEntity;
};

export type AdminUserAcceptedEvent = {
  user: UserEntity;
};

export type AdminEvents = {
  userAccepted: AdminUserAcceptedEvent;
  userRejected: AdminUserRejectedEvent;
};

export class DiscordAdminMessaging extends Emitter<AdminEvents> implements OnModuleInit {
  private static readonly logger = new Logger(DiscordAdminMessaging.name);

  static async create(
    config: Config,
    discordService: DiscordService,
    usersRepository: UsersRepository,
  ): Promise<DiscordAdminMessaging> {
    const channel = await discordService.getChannel(config.channelId);
    if (channel.type !== ChannelType.GuildText) {
      throw new Error(`Channel with ID ${config.channelId} is not a text channel`);
    }
    return new DiscordAdminMessaging(config, discordService, channel as TextChannel, usersRepository);
  }

  private constructor(
    private readonly config: Config,
    private readonly discordService: DiscordService,
    private readonly channel: TextChannel,
    private readonly usersRepository: UsersRepository,
  ) {
    super();
  }

  async onModuleInit(): Promise<void> {
    this.discordService.onReaction(async (adminId, messageId, reaction) => {
      if (!this.config.adminIds.includes(adminId)) {
        DiscordAdminMessaging.logger.warn(`Unknown admin ID ${adminId}`);
        return;
      }

      const user = await this.usersRepository.getByApprovalMessageId(messageId);
      if (user) {
        this.onUserRequestReact(user, reaction);
        return;
      }
    });
  }

  private async onUserRequestReact(user: UserEntity, reaction: string): Promise<void> {
    const event = USER_EVENT_BY_REACTION[reaction as keyof typeof USER_EVENT_BY_REACTION];
    if (!event) {
      DiscordAdminMessaging.logger.warn(`Unknown reaction ${reaction} for user ${user.id}`);
      return;
    }

    this.emit(event, { user });
  }

  async newRegistrationRequest(user: UserEntity): Promise<void> {
    const embed = new EmbedBuilder().setColor('#3498db');

    embed.setTitle(`Nouvelle demande d'inscription: ${user.name}`);
    embed.addFields({ name: _.capitalize(user.messagingKey), value: user.messagingId });

    const message = await this.channel.send({ embeds: [embed] });
    await this.usersRepository.linkApprovalMessageId(user.id, message.id);
  }
}
