import { Logger, OnModuleInit } from '@nestjs/common';
import { ChannelType, EmbedBuilder, TextChannel, ThreadAutoArchiveDuration } from 'discord.js';
import * as _ from 'lodash';

import { JellyfinUser } from '@/modules/jellyfin/jellyfin';
import { MediaRequestEntity, MediaRequestsRepository, RequestStatus } from '@/services/database/mediaRequests';
import { UserEntity, UsersRepository } from '@/services/database/users';
import { DiscordService } from '@/services/discord';

export type Config = {
  channelId: string;
};

export const EMOJI_BY_STATUS: Record<RequestStatus, string> = {
  pending: '⏳',
  in_progress: '👀',
  fulfilled: '✅',
  missing: '🫥',
  rejected: '⛔️',
  canceled: '🗑️',
} as const;
export const EMOJI_NAME_BY_STATUS: Record<RequestStatus, string> = {
  pending: 'sandglass',
  in_progress: 'eyes',
  fulfilled: 'white_check_mark',
  missing: 'dotted_line_face',
  rejected: 'no_entry',
  canceled: 'wastebasket',
} as const;
export const LABEL_BY_STATUS: Record<RequestStatus, string> = {
  pending: 'Enregistrée',
  in_progress: 'En cours',
  fulfilled: 'Disponible',
  missing: 'Introuvable',
  rejected: 'Rejetée',
  canceled: 'Annulée',
} as const;

export type NewRequestContext = {
  media: MediaRequestEntity;
  users: JellyfinUser[];
};

export type RequestContext = {
  threadId: string;
  messageId: string;
  media: MediaRequestEntity;
  status: RequestStatus;
  users: JellyfinUser[];
};

const ADMIN_IDS = ['504641115073544193'];

const ADMIN_MEDIA_REQUEST_REACTIONS = ['👀', '🫥', '⛔️'] as const;
const ADMIN_USER_REQUEST_REACTIONS = ['✅', '❌'] as const;

function setEmbedField(embed: EmbedBuilder, request: MediaRequestEntity): EmbedBuilder {
  embed
    .setTitle(`${request.title} (${request.year})`)
    .setURL(`https://www.imdb.com/fr/title/${request.imdbId}/`)
    .setFields({ name: 'Status', value: `${EMOJI_BY_STATUS[request.status]} ${LABEL_BY_STATUS[request.status]}` });

  if (request.type === 'episode') {
    embed.addFields(
      { name: 'Saisons', value: `${request.seasonNumber}`, inline: true },
      { name: 'Episode', value: `${request.episodeNumber}`, inline: true },
    );
  }

  if (request.status === 'pending') {
    embed.addFields({ name: 'Utilisateurs', value: request.users?.map((user) => user.name).join(', ') ?? 'N/A' });
  }

  return embed;
}

export class DiscordAdminMessaging implements OnModuleInit {
  static readonly logger = new Logger(DiscordAdminMessaging.name);

  static async create(
    config: Config,
    discordService: DiscordService,
    mediaRequestsRepository: MediaRequestsRepository,
    usersRepository: UsersRepository,
  ): Promise<DiscordAdminMessaging> {
    const channel = await discordService.getChannel(config.channelId);
    if (channel.type !== ChannelType.GuildText) {
      throw new Error(`Channel with ID ${config.channelId} is not a text channel`);
    }
    return new DiscordAdminMessaging(discordService, channel as TextChannel, mediaRequestsRepository, usersRepository);
  }

  private constructor(
    private readonly discordService: DiscordService,
    private readonly channel: TextChannel,
    private readonly mediaRequestsRepository: MediaRequestsRepository,
    private readonly usersRepository: UsersRepository,
  ) {}

  async onModuleInit(): Promise<void> {
    this.discordService.onReaction(async (adminId, messageId, reaction) => {
      if (!ADMIN_IDS.includes(adminId)) {
        DiscordAdminMessaging.logger.warn(`Unknown admin ID ${adminId}`);
        return;
      }

      const mediaRequest = await this.mediaRequestsRepository.findByThreadId(messageId);
      if (mediaRequest) {
        await this.onMediaRequestReact(mediaRequest, reaction);
        return;
      }

      const user = await this.usersRepository.findByRegisterMessageId(messageId);
      if (user) {
        await this.onUserRequestReact(user, reaction);
        return;
      }
    });
  }

  private async onMediaRequestReact(request: MediaRequestEntity, reaction: string): Promise<void> {
    if (!ADMIN_MEDIA_REQUEST_REACTIONS.includes(reaction as (typeof ADMIN_MEDIA_REQUEST_REACTIONS)[number])) {
      DiscordAdminMessaging.logger.warn(`Unknown reaction ${reaction} for media request ${request.id}`);
      return;
    }

    const status = Object.entries(EMOJI_BY_STATUS).find(([, emojiName]) => emojiName === reaction)![0] as RequestStatus;
    DiscordAdminMessaging.logger.log(`Updating status of media request ${request.id} to ${status}`);
    await this.mediaRequestsRepository.updateStatus(request.id, status);
  }

  private async onUserRequestReact(user: UserEntity, reaction: string): Promise<void> {
    if (!ADMIN_USER_REQUEST_REACTIONS.includes(reaction as (typeof ADMIN_USER_REQUEST_REACTIONS)[number])) {
      DiscordAdminMessaging.logger.warn(`Unknown reaction ${reaction} for user ${user.id}`);
      return;
    }

    switch (reaction) {
      case 'white_check_mark':
        DiscordAdminMessaging.logger.log(`Approving user ${user.id}`);
        break;
      case 'x':
        DiscordAdminMessaging.logger.log(`Rejecting user ${user.id}`);
        break;
    }
  }

  async newRegistrationRequest(user: UserEntity): Promise<void> {
    const embed = new EmbedBuilder().setColor('#3498db');

    embed.setTitle(`Nouvelle demande d'inscription: ${user.name}`);
    embed.addFields({ name: _.capitalize(user.messagingKey), value: user.messagingId });

    const message = await this.channel.send({ embeds: [embed] });
    await this.usersRepository.attachMessage(user, message.id);
  }

  async newMediaRequest(request: MediaRequestEntity): Promise<MediaRequestEntity> {
    const embed = new EmbedBuilder().setColor('#3498db');

    const message = await this.channel.send({ embeds: [setEmbedField(embed, request)] });
    await message.react(EMOJI_BY_STATUS[request.status]);

    const thread = await message.startThread({
      name: `Suivi: ${request.title} (${request.year})`,
      autoArchiveDuration: ThreadAutoArchiveDuration.OneWeek,
    });

    await this.mediaRequestsRepository.attachThread(request, thread.id);

    return request;
  }

  async updateMediaStatus(request: MediaRequestEntity): Promise<void> {
    if (!request.threadId) {
      await this.newMediaRequest(request);
      return;
    }

    const thread = await DiscordService.getThread(this.channel, request.threadId);
    await thread.send(`Statut mis à jour: ${EMOJI_BY_STATUS[request.status]} ${LABEL_BY_STATUS[request.status]}`);

    const head = await DiscordService.getHeadOfThread(this.channel, request.threadId);

    await head.edit({ embeds: [setEmbedField(EmbedBuilder.from(head.embeds[0]), request)] });

    await head.reactions.removeAll();
    await head.react(EMOJI_BY_STATUS[request.status]);
  }

  async updateRequesters(request: MediaRequestEntity, users: UserEntity[]): Promise<void> {
    if (!request.threadId) {
      await this.newMediaRequest(request);
      return;
    }

    const thread = await DiscordService.getThread(this.channel, request.threadId);
    await thread.send(`Changement de demandeurs: ${users.map((user) => user.name).join(', ')}`);

    const head = await DiscordService.getHeadOfThread(this.channel, request.threadId);

    await head.edit({ embeds: [setEmbedField(EmbedBuilder.from(head.embeds[0]), request)] });
  }
}
