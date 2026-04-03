import { Logger, OnModuleInit } from '@nestjs/common';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  Message,
  TextChannel,
} from 'discord.js';
import * as _ from 'lodash';

import { Emitter } from '@/helpers/events';
import { DiscordService } from '@/modules/discord/discord';
import { DiscordWired } from '@/services/database/discord-wired';
import { DownloadJobEntity, DownloadJobsRepository } from '@/services/database/download-jobs';
import { MediaEntity } from '@/services/database/medias';
import { RequestEntity, RequestsRepository, RequestStatus } from '@/services/database/requests';
import { UserEntity, UsersRepository } from '@/services/database/users';
import { truthy } from '@/utils';

export type Config = {
  channelId: string;
  adminIds: string[];
};

export enum DiscordEntityType {
  User = 'user',
  Request = 'request',
  DownloadJob = 'downloadJob',
}

export type DiscordEntityMap = {
  [DiscordEntityType.User]: UserEntity;
  [DiscordEntityType.Request]: RequestEntity;
  [DiscordEntityType.DownloadJob]: DownloadJobEntity;
};

type EntityRepositoryMap = { [T in DiscordEntityType]: DiscordWired<DiscordEntityMap[T]> };

export type DiscordEntityResult = {
  [T in DiscordEntityType]: { type: T; entity: DiscordEntityMap[T] };
}[DiscordEntityType];

export enum AdminEventType {
  UserAccepted = 'userAccepted',
  UserRejected = 'userRejected',
  IdentificationRetry = 'identificationRetry',
  ImdbResolve = 'imdbResolve',
}

enum ButtonId {
  UserAccept = 'user-accept',
  UserReject = 'user-reject',
  RequestReject = 'request-reject',
  RequestUnreject = 'request-unreject',
}

function buildUserApprovalButtons(): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(ButtonId.UserAccept).setLabel('Accepter').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(ButtonId.UserReject).setLabel('Refuser').setStyle(ButtonStyle.Danger),
  );
}

function buildRequestRejectButton(): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(ButtonId.RequestReject).setLabel('Rejeter').setStyle(ButtonStyle.Danger),
  );
}

function buildRequestUnrejectButton(): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(ButtonId.RequestUnreject).setLabel('Restaurer').setStyle(ButtonStyle.Secondary),
  );
}

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

  private get wiredRepositories(): EntityRepositoryMap {
    return {
      [DiscordEntityType.User]: this.usersRepository,
      [DiscordEntityType.Request]: this.requestsRepository,
      [DiscordEntityType.DownloadJob]: this.downloadJobsRepository,
    };
  }

  async getEntityByDiscordMessageId(messageId: string): Promise<DiscordEntityResult | null> {
    for (const [type, repo] of Object.entries(this.wiredRepositories)) {
      const entity = await repo.getByDiscordMessageId(messageId);
      if (entity) {
        return <DiscordEntityResult>{ type, entity };
      }
    }
    return null;
  }

  async onModuleInit(): Promise<void> {
    this.discordService.onButtonInteraction(async (interaction: ButtonInteraction) => {
      if (interaction.channelId !== this.config.channelId) {
        return;
      }
      if (!this.config.adminIds.includes(interaction.user.id)) {
        return;
      }

      await this.handleButtonInteraction(interaction);
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

      await this.handleMessageInteraction(message);
    });
  }

  // --- Reply handlers by entity type ---

  private readonly replyHandlers: {
    [T in DiscordEntityType]?: (result: Extract<DiscordEntityResult, { type: T }>, message: Message) => Promise<void>;
  } = {
    [DiscordEntityType.DownloadJob]: async (result, message) => {
      const imdbMatch = message.content.match(/tt\d{7,}/);
      if (!imdbMatch) {
        return;
      }
      this.emit(AdminEventType.IdentificationRetry, {
        job: result.entity,
        imdbId: imdbMatch[0],
        replyMessageId: message.id,
      });
    },
    [DiscordEntityType.Request]: async (result, message) => {
      const imdbMatch = message.content.match(/tt\d{7,}/);
      if (!imdbMatch) {
        return;
      }
      this.emit(AdminEventType.ImdbResolve, {
        request: result.entity,
        imdbId: imdbMatch[0],
        replyMessageId: message.id,
      });
    },
  };

  // --- Button handlers by entity type ---

  private readonly buttonHandlers: {
    [T in DiscordEntityType]?: (
      result: Extract<DiscordEntityResult, { type: T }>,
      interaction: ButtonInteraction,
    ) => Promise<void>;
  } = {
    [DiscordEntityType.User]: async (result, interaction) => {
      switch (interaction.customId) {
        case ButtonId.UserAccept:
          this.emit(AdminEventType.UserAccepted, { user: result.entity });
          await interaction.update({ components: [] });
          break;
        case ButtonId.UserReject:
          this.emit(AdminEventType.UserRejected, { user: result.entity });
          await interaction.update({ components: [] });
          break;
      }
    },
    [DiscordEntityType.Request]: async (result, interaction) => {
      switch (interaction.customId) {
        case ButtonId.RequestReject:
          DiscordAdminMessaging.logger.log(`Rejecting request ${result.entity.mediaId} via button`);
          await this.requestsRepository.updateStatus(result.entity.mediaId, RequestStatus.Rejected);
          await interaction.update({ components: [buildRequestUnrejectButton()] });
          break;
        case ButtonId.RequestUnreject:
          DiscordAdminMessaging.logger.log(`Un-rejecting request ${result.entity.mediaId} via button`);
          await this.requestsRepository.updateStatus(result.entity.mediaId, RequestStatus.Pending);
          await interaction.update({ components: [buildRequestRejectButton()] });
          break;
      }
    },
  };

  private async handleMessageInteraction(message: Message): Promise<void> {
    const result = await this.getEntityByDiscordMessageId(message.reference!.messageId!);
    if (!result) {
      return;
    }

    await this.dispatchByEntityType(this.replyHandlers, result, message);
  }

  private async handleButtonInteraction(interaction: ButtonInteraction): Promise<void> {
    const result = await this.getEntityByDiscordMessageId(interaction.message.id);
    if (!result) {
      return;
    }

    await this.dispatchByEntityType(this.buttonHandlers, result, interaction);
  }

  private async dispatchByEntityType<TArg>(
    handlers: {
      [T in DiscordEntityType]?: (result: Extract<DiscordEntityResult, { type: T }>, arg: TArg) => Promise<void>;
    },
    result: DiscordEntityResult,
    arg: TArg,
  ): Promise<void> {
    const handler = handlers[result.type] as ((result: DiscordEntityResult, arg: TArg) => Promise<void>) | undefined;
    if (handler) {
      await handler(result, arg);
    }
  }

  async newRegistrationRequest(user: UserEntity): Promise<void> {
    const embed = new EmbedBuilder().setColor('#3498db');

    embed.setTitle(`Nouvelle demande d'inscription: ${user.name}`);
    embed.addFields({ name: _.capitalize(user.messagingKey), value: user.messagingId });

    const message = await this.channel.send({ embeds: [embed], components: [buildUserApprovalButtons()] });
    await this.usersRepository.linkDiscordMessageId(user.id, message.id);
  }

  async deleteUserMessage(user: UserEntity): Promise<void> {
    if (!user.discordMessageId) {
      return;
    }

    try {
      const message = await DiscordService.getMessage(this.channel, user.discordMessageId);
      await message.delete();
    } catch (error) {
      DiscordAdminMessaging.logger.error(
        `Failed to delete approval message ${user.discordMessageId}: ${error instanceof Error ? error.message : error}`,
      );
    }
  }

  // --- Media request notifications ---

  async registerRequest(request: RequestEntity): Promise<void> {
    const media = request.media!;
    const embed = buildRequestEmbed(request, EMBED_COLORS.pending);

    try {
      const message = await this.channel.send({ embeds: [embed], components: [buildRequestRejectButton()] });
      await this.requestsRepository.attachDiscordMessageId(request.mediaId, message.id);
      DiscordAdminMessaging.logger.log(`Discord message created for "${media.title}" (${message.id})`);
    } catch (error) {
      DiscordAdminMessaging.logger.error(
        `Failed to create Discord message for "${media.title}": ${error instanceof Error ? error.message : error}`,
      );
    }
  }

  async updateRequestStatus(request: RequestEntity): Promise<void> {
    if (!request.discordMessageId) {
      return;
    }

    try {
      if (request.status === RequestStatus.Fulfilled) {
        const message = await DiscordService.getMessage(this.channel, request.discordMessageId);
        await message.delete();
        DiscordAdminMessaging.logger.log(`Deleted Discord message ${request.discordMessageId} (fulfilled)`);
        return;
      }

      const color = request.status === RequestStatus.Rejected ? EMBED_COLORS.rejected : EMBED_COLORS.pending;
      const embed = buildRequestEmbed(request, color);
      const components =
        request.status === RequestStatus.Rejected ? [buildRequestUnrejectButton()] : [buildRequestRejectButton()];
      const message = await DiscordService.getMessage(this.channel, request.discordMessageId);
      await message.edit({ embeds: [embed], components });
      DiscordAdminMessaging.logger.log(`Updated Discord message ${request.discordMessageId} (${request.status})`);
    } catch (error) {
      DiscordAdminMessaging.logger.error(
        `Failed to update Discord message ${request.discordMessageId}: ${error instanceof Error ? error.message : error}`,
      );
    }
  }

  async deleteRequestMessage(request: RequestEntity): Promise<void> {
    if (!request.discordMessageId) {
      return;
    }

    try {
      const message = await DiscordService.getMessage(this.channel, request.discordMessageId);
      await message.delete();
      DiscordAdminMessaging.logger.log(`Deleted Discord message ${request.discordMessageId}`);
    } catch (error) {
      DiscordAdminMessaging.logger.error(
        `Failed to delete Discord message ${request.discordMessageId}: ${error instanceof Error ? error.message : error}`,
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
      if (request?.discordMessageId) {
        try {
          const message = await DiscordService.getMessage(this.channel, request.discordMessageId);
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
    await this.requestsRepository.attachDiscordMessageId(request.mediaId, message.id);
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
    if (!request.discordMessageId) {
      return;
    }

    try {
      const color = request.status === RequestStatus.Rejected ? EMBED_COLORS.rejected : EMBED_COLORS.pending;
      const embed = buildRequestEmbed(request, color);
      const message = await DiscordService.getMessage(this.channel, request.discordMessageId);
      await message.edit({ embeds: [embed] });
    } catch (error) {
      DiscordAdminMessaging.logger.error(
        `Failed to update users on Discord message ${request.discordMessageId}: ${error instanceof Error ? error.message : error}`,
      );
    }
  }
}
