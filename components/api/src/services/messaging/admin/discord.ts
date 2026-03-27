import { Logger, OnModuleInit } from '@nestjs/common';
import { ChannelType, EmbedBuilder, TextChannel } from 'discord.js';
import * as _ from 'lodash';

import { Emitter } from '@/helpers/events';
import { MediaEntity } from '@/services/database/medias';
import { RequestEntity, RequestsRepository, RequestStatus } from '@/services/database/requests';
import { UserEntity, UsersRepository } from '@/services/database/users';
import { DiscordService } from '@/services/discord';
import { truthy } from '@/utils';

export type Config = {
  channelId: string;
  adminIds: string[];
};

const USER_EVENT_BY_REACTION = {
  '✅': 'userAccepted',
  '❌': 'userRejected',
} as const;

const EMBED_COLORS = {
  pending: 0xe67e22,
  rejected: 0xe74c3c,
  missing: 0x95a5a6,
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

function mediaName(media: MediaEntity): string {
  const base = `${media.title} (${media.year})`;
  if (media.type === 'episode' && media.seasonNumber !== null && media.episodeNumber !== null) {
    return `${base} S${media.seasonNumber}E${media.episodeNumber}`;
  }
  return base;
}

function buildRequestEmbed(request: RequestEntity, color: number): EmbedBuilder {
  const media = request.media!;
  const userNames = request.userRequests?.map((ur) => ur.user?.name).filter(truthy) ?? [];

  const embed = new EmbedBuilder().setColor(color).setTitle(mediaName(media));

  embed.addFields({ name: 'Type', value: media.type, inline: true });
  embed.addFields({ name: 'Status', value: request.status, inline: true });

  if (userNames.length > 0) {
    embed.addFields({ name: 'Users', value: userNames.join(', ') });
  }

  if (media.imdbId) {
    embed.addFields({ name: 'IMDb', value: `https://www.imdb.com/title/${media.imdbId}`, inline: true });
  }

  if (request.darkiworldUrl) {
    embed.addFields({ name: 'Darkiworld', value: request.darkiworldUrl });
  }

  return embed;
}

export class DiscordAdminMessaging extends Emitter<AdminEvents> implements OnModuleInit {
  private static readonly logger = new Logger(DiscordAdminMessaging.name);

  static async create(
    config: Config,
    discordService: DiscordService,
    usersRepository: UsersRepository,
    requestsRepository: RequestsRepository,
  ): Promise<DiscordAdminMessaging> {
    const channel = await discordService.getChannel(config.channelId);
    if (channel.type !== ChannelType.GuildText) {
      throw new Error(`Channel with ID ${config.channelId} is not a text channel`);
    }
    return new DiscordAdminMessaging(
      config,
      discordService,
      channel as TextChannel,
      usersRepository,
      requestsRepository,
    );
  }

  private constructor(
    private readonly config: Config,
    private readonly discordService: DiscordService,
    private readonly channel: TextChannel,
    private readonly usersRepository: UsersRepository,
    private readonly requestsRepository: RequestsRepository,
  ) {
    super();
  }

  async onModuleInit(): Promise<void> {
    this.discordService.onReaction(async (adminId, messageId, reaction) => {
      if (!this.config.adminIds.includes(adminId)) {
        return;
      }

      const user = await this.usersRepository.getByApprovalMessageId(messageId);
      if (user) {
        this.onUserRequestReact(user, reaction);
        return;
      }

      if (reaction === '❌') {
        const request = await this.requestsRepository.getByTaskId(messageId);
        if (request && request.status !== RequestStatus.Rejected) {
          DiscordAdminMessaging.logger.log(`Rejecting request ${request.mediaId} via Discord reaction`);
          await this.requestsRepository.updateStatus(request.mediaId, RequestStatus.Rejected);
        }
      }
    });

    this.discordService.onReactionRemove(async (adminId, messageId, reaction) => {
      if (!this.config.adminIds.includes(adminId)) {
        return;
      }

      if (reaction === '❌') {
        const request = await this.requestsRepository.getByTaskId(messageId);
        if (request && request.status === RequestStatus.Rejected) {
          DiscordAdminMessaging.logger.log(`Un-rejecting request ${request.mediaId} via Discord reaction removal`);
          await this.requestsRepository.updateStatus(request.mediaId, RequestStatus.Pending);
        }
      }
    });
  }

  // --- User registration ---

  private async onUserRequestReact(user: UserEntity, reaction: string): Promise<void> {
    const event = USER_EVENT_BY_REACTION[reaction as keyof typeof USER_EVENT_BY_REACTION];
    if (!event) {
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

  async deleteApprovalMessage(user: UserEntity): Promise<void> {
    if (!user.approvalMessageId) {
      return;
    }

    try {
      const message = await DiscordService.getMessage(this.channel, user.approvalMessageId);
      await message.delete();
    } catch (error) {
      DiscordAdminMessaging.logger.error(
        `Failed to delete approval message ${user.approvalMessageId}: ${error instanceof Error ? error.message : error}`,
      );
    }
  }

  // --- Media request notifications ---

  async registerRequest(request: RequestEntity): Promise<void> {
    const media = request.media!;
    const embed = buildRequestEmbed(request, EMBED_COLORS.pending);

    try {
      const message = await this.channel.send({ embeds: [embed] });
      await this.requestsRepository.attachTask(request.mediaId, message.id);
      DiscordAdminMessaging.logger.log(`Discord message created for "${media.title}" (${message.id})`);
    } catch (error) {
      DiscordAdminMessaging.logger.error(
        `Failed to create Discord message for "${media.title}": ${error instanceof Error ? error.message : error}`,
      );
    }
  }

  async updateRequestStatus(request: RequestEntity): Promise<void> {
    if (!request.taskId) {
      return;
    }

    try {
      if (request.status === RequestStatus.Fulfilled) {
        const message = await DiscordService.getMessage(this.channel, request.taskId);
        await message.delete();
        DiscordAdminMessaging.logger.log(`Deleted Discord message ${request.taskId} (fulfilled)`);
        return;
      }

      const color = request.status === RequestStatus.Rejected ? EMBED_COLORS.rejected : EMBED_COLORS.pending;
      const embed = buildRequestEmbed(request, color);
      const message = await DiscordService.getMessage(this.channel, request.taskId);
      await message.edit({ embeds: [embed] });
      DiscordAdminMessaging.logger.log(`Updated Discord message ${request.taskId} (${request.status})`);
    } catch (error) {
      DiscordAdminMessaging.logger.error(
        `Failed to update Discord message ${request.taskId}: ${error instanceof Error ? error.message : error}`,
      );
    }
  }

  async deleteRequestMessage(request: RequestEntity): Promise<void> {
    if (!request.taskId) {
      return;
    }

    try {
      const message = await DiscordService.getMessage(this.channel, request.taskId);
      await message.delete();
      DiscordAdminMessaging.logger.log(`Deleted Discord message ${request.taskId}`);
    } catch (error) {
      DiscordAdminMessaging.logger.error(
        `Failed to delete Discord message ${request.taskId}: ${error instanceof Error ? error.message : error}`,
      );
    }
  }

  async updateRequestUsers(request: RequestEntity): Promise<void> {
    if (!request.taskId) {
      return;
    }

    try {
      const color = request.status === RequestStatus.Rejected ? EMBED_COLORS.rejected : EMBED_COLORS.pending;
      const embed = buildRequestEmbed(request, color);
      const message = await DiscordService.getMessage(this.channel, request.taskId);
      await message.edit({ embeds: [embed] });
    } catch (error) {
      DiscordAdminMessaging.logger.error(
        `Failed to update users on Discord message ${request.taskId}: ${error instanceof Error ? error.message : error}`,
      );
    }
  }
}
