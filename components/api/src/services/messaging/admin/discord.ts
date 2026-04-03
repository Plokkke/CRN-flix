import { Logger, OnModuleInit } from '@nestjs/common';
import { ChannelType, EmbedBuilder, Message, TextChannel } from 'discord.js';
import * as _ from 'lodash';

import { Emitter } from '@/helpers/events';
import { DiscordService } from '@/modules/discord/discord';
import { DownloadJobEntity, DownloadJobsRepository } from '@/services/database/download-jobs';
import { MediaEntity } from '@/services/database/medias';
import { RequestEntity, RequestsRepository, RequestStatus } from '@/services/database/requests';
import { UserEntity, UsersRepository } from '@/services/database/users';
import { truthy } from '@/utils';

export type Config = {
  channelId: string;
  adminIds: string[];
};

export enum AdminEventType {
  UserAccepted = 'userAccepted',
  UserRejected = 'userRejected',
  IdentificationRetry = 'identificationRetry',
  ImdbResolve = 'imdbResolve',
}

const USER_EVENT_BY_REACTION: Record<string, AdminEventType> = {
  '✅': AdminEventType.UserAccepted,
  '❌': AdminEventType.UserRejected,
};

const EMBED_COLORS = {
  pending: 0xe67e22,
  rejected: 0xe74c3c,
  missing: 0x95a5a6,
} as const;

export type AdminUserAcceptedEvent = { user: UserEntity };
export type AdminUserRejectedEvent = { user: UserEntity };
export type AdminIdentificationRetryEvent = { job: DownloadJobEntity; imdbId: string; replyMessageId: string };
export type AdminImdbResolveEvent = { request: RequestEntity; imdbId: string; replyMessageId: string };

export type AdminEventMap = {
  [AdminEventType.UserAccepted]: AdminUserAcceptedEvent;
  [AdminEventType.UserRejected]: AdminUserRejectedEvent;
  [AdminEventType.IdentificationRetry]: AdminIdentificationRetryEvent;
  [AdminEventType.ImdbResolve]: AdminImdbResolveEvent;
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
    embed.addFields({ name: 'IMDb', value: media.imdbId, inline: true });
  }

  if (request.darkiworldUrl) {
    embed.addFields({ name: 'Darkiworld', value: `[Telecharger](${request.darkiworldUrl})`, inline: true });
  }

  return embed;
}

export class DiscordAdminMessaging extends Emitter<AdminEventMap> implements OnModuleInit {
  private static readonly logger = new Logger(DiscordAdminMessaging.name);

  static async create(
    config: Config,
    discordService: DiscordService,
    usersRepository: UsersRepository,
    requestsRepository: RequestsRepository,
    downloadJobsRepository: DownloadJobsRepository,
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
      downloadJobsRepository,
    );
  }

  private constructor(
    private readonly config: Config,
    private readonly discordService: DiscordService,
    private readonly channel: TextChannel,
    private readonly usersRepository: UsersRepository,
    private readonly requestsRepository: RequestsRepository,
    private readonly downloadJobsRepository: DownloadJobsRepository,
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
        const request = await this.requestsRepository.getByThreadId(messageId);
        if (request && request.status !== RequestStatus.Rejected) {
          DiscordAdminMessaging.logger.log(`Rejecting request ${request.mediaId} via Discord reaction`);
          await this.requestsRepository.updateStatus(request.mediaId, RequestStatus.Rejected);
        }
      }
    });

    this.discordService.onGuildMessage(async (message: Message) => {
      if (message.channelId !== this.config.channelId) {
        return;
      }
      if (!this.config.adminIds.includes(message.author.id)) {
        return;
      }
      if (!message.reference?.messageId) {
        return;
      }

      const imdbMatch = message.content.match(/tt\d{7,}/);
      if (!imdbMatch) {
        return;
      }

      const imdbId = imdbMatch[0];
      const referencedMessageId = message.reference.messageId;

      const job = await this.downloadJobsRepository.getByDiscordErrorMessageId(referencedMessageId);
      if (job) {
        this.emit(AdminEventType.IdentificationRetry, { job, imdbId, replyMessageId: message.id });
        return;
      }

      const request = await this.requestsRepository.getByThreadId(referencedMessageId);
      if (request) {
        this.emit(AdminEventType.ImdbResolve, { request, imdbId, replyMessageId: message.id });
      }
    });

    this.discordService.onReactionRemove(async (adminId, messageId, reaction) => {
      if (!this.config.adminIds.includes(adminId)) {
        return;
      }

      if (reaction === '❌') {
        const request = await this.requestsRepository.getByThreadId(messageId);
        if (request && request.status === RequestStatus.Rejected) {
          DiscordAdminMessaging.logger.log(`Un-rejecting request ${request.mediaId} via Discord reaction removal`);
          await this.requestsRepository.updateStatus(request.mediaId, RequestStatus.Pending);
        }
      }
    });
  }

  // --- User registration ---

  private async onUserRequestReact(user: UserEntity, reaction: string): Promise<void> {
    const eventType = USER_EVENT_BY_REACTION[reaction];
    if (!eventType) {
      return;
    }

    this.emit(eventType, { user });
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
      await this.requestsRepository.attachThread(request.mediaId, message.id);
      DiscordAdminMessaging.logger.log(`Discord message created for "${media.title}" (${message.id})`);
    } catch (error) {
      DiscordAdminMessaging.logger.error(
        `Failed to create Discord message for "${media.title}": ${error instanceof Error ? error.message : error}`,
      );
    }
  }

  async updateRequestStatus(request: RequestEntity): Promise<void> {
    if (!request.threadId) {
      return;
    }

    try {
      if (request.status === RequestStatus.Fulfilled) {
        const message = await DiscordService.getMessage(this.channel, request.threadId);
        await message.delete();
        DiscordAdminMessaging.logger.log(`Deleted Discord message ${request.threadId} (fulfilled)`);
        return;
      }

      const color = request.status === RequestStatus.Rejected ? EMBED_COLORS.rejected : EMBED_COLORS.pending;
      const embed = buildRequestEmbed(request, color);
      const message = await DiscordService.getMessage(this.channel, request.threadId);
      await message.edit({ embeds: [embed] });
      DiscordAdminMessaging.logger.log(`Updated Discord message ${request.threadId} (${request.status})`);
    } catch (error) {
      DiscordAdminMessaging.logger.error(
        `Failed to update Discord message ${request.threadId}: ${error instanceof Error ? error.message : error}`,
      );
    }
  }

  async deleteRequestMessage(request: RequestEntity): Promise<void> {
    if (!request.threadId) {
      return;
    }

    try {
      const message = await DiscordService.getMessage(this.channel, request.threadId);
      await message.delete();
      DiscordAdminMessaging.logger.log(`Deleted Discord message ${request.threadId}`);
    } catch (error) {
      DiscordAdminMessaging.logger.error(
        `Failed to delete Discord message ${request.threadId}: ${error instanceof Error ? error.message : error}`,
      );
    }
  }

  async notifyPipelineFailure(
    fileNames: string,
    failedStep: string,
    errorMessage: string,
    mediaRequestId: string | null,
  ): Promise<void> {
    const embed = new EmbedBuilder()
      .setColor(0xe74c3c)
      .setTitle('Pipeline Error')
      .addFields(
        { name: 'Files', value: fileNames.slice(0, 1024) },
        { name: 'Step', value: failedStep, inline: true },
        { name: 'Error', value: errorMessage.slice(0, 1024) },
      );

    if (mediaRequestId) {
      const request = await this.requestsRepository.get(mediaRequestId);
      if (request?.threadId) {
        try {
          const message = await DiscordService.getMessage(this.channel, request.threadId);
          await message.reply({ embeds: [embed] });
          return;
        } catch {
          // fall through to channel post
        }
      }
    }

    await this.channel.send({ embeds: [embed] });
  }

  async notifyIdentificationFailure(packageName: string, failedFiles: string[], errorMessage: string): Promise<string> {
    const embed = new EmbedBuilder()
      .setColor(0xe74c3c)
      .setTitle('Identification Error')
      .addFields(
        { name: 'Package', value: packageName.slice(0, 1024) },
        { name: 'Fichiers', value: failedFiles.join('\n').slice(0, 1024) },
        { name: 'Erreur', value: errorMessage.slice(0, 1024) },
      )
      .setFooter({ text: 'Repondre avec un IMDb ID (ex: tt1234567) pour relancer' });

    const message = await this.channel.send({ embeds: [embed] });
    return message.id;
  }

  async notifyMissingImdbId(request: RequestEntity): Promise<void> {
    const media = request.media!;
    const embed = new EmbedBuilder()
      .setColor(0xe67e22)
      .setTitle(`IMDb ID manquant: ${mediaName(media)}`)
      .addFields({ name: 'Type', value: media.type, inline: true }, { name: 'Titre', value: media.title, inline: true })
      .setFooter({ text: 'Repondre avec un IMDb ID (ex: tt1234567) pour associer' });

    if (media.year) {
      embed.addFields({ name: 'Annee', value: String(media.year), inline: true });
    }

    const message = await this.channel.send({ embeds: [embed] });
    await this.requestsRepository.attachThread(request.mediaId, message.id);
    DiscordAdminMessaging.logger.log(`Missing IMDb notification for "${media.title}" (${message.id})`);
  }

  async reactToMessage(messageId: string, emoji: string): Promise<void> {
    try {
      const message = await DiscordService.getMessage(this.channel, messageId);
      await message.react(emoji);
    } catch (error) {
      DiscordAdminMessaging.logger.error(
        `Failed to react to message ${messageId}: ${error instanceof Error ? error.message : error}`,
      );
    }
  }

  async updateRequestUsers(request: RequestEntity): Promise<void> {
    if (!request.threadId) {
      return;
    }

    try {
      const color = request.status === RequestStatus.Rejected ? EMBED_COLORS.rejected : EMBED_COLORS.pending;
      const embed = buildRequestEmbed(request, color);
      const message = await DiscordService.getMessage(this.channel, request.threadId);
      await message.edit({ embeds: [embed] });
    } catch (error) {
      DiscordAdminMessaging.logger.error(
        `Failed to update users on Discord message ${request.threadId}: ${error instanceof Error ? error.message : error}`,
      );
    }
  }
}
