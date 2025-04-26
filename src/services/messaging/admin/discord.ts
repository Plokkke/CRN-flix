import { Logger, OnModuleInit } from '@nestjs/common';
import { ChannelType, EmbedBuilder, TextChannel, ThreadAutoArchiveDuration } from 'discord.js';
import * as _ from 'lodash';

import { Emitter } from '@/helpers/events';
import { JellyfinUser } from '@/modules/jellyfin/jellyfin';
import { MediaEntity, MediasRepository } from '@/services/database/medias';
import { RequestEntity, RequestsRepository, RequestStatus } from '@/services/database/requests';
import { UserEntity, UsersRepository } from '@/services/database/users';
import { DiscordService } from '@/services/discord';

export type Config = {
  channelId: string;
  adminIds: string[];
};

export const EMOJI_BY_STATUS: Record<RequestStatus, string> = {
  pending: '⏳',
  fulfilled: '✅',
  missing: '🫥',
  rejected: '⛔️',
  canceled: '🗑️',
} as const;
export const EMOJI_NAME_BY_STATUS: Record<RequestStatus, string> = {
  pending: 'sandglass',
  fulfilled: 'white_check_mark',
  missing: 'dotted_line_face',
  rejected: 'no_entry',
  canceled: 'wastebasket',
} as const;
export const LABEL_BY_STATUS: Record<RequestStatus, string> = {
  pending: 'Enregistrée',
  fulfilled: 'Disponible',
  missing: 'Introuvable',
  rejected: 'Rejetée',
  canceled: 'Annulée',
} as const;

export type NewRequestContext = {
  media: MediaEntity;
  users: JellyfinUser[];
};

const MEDIA_REQUEST_STATUS_BY_REACTION = {
  '🫥': 'missing',
  '⛔️': 'rejected',
} as const;

const USER_EVENT_BY_REACTION = {
  '✅': 'userAccepted',
  '❌': 'userRejected',
} as const;

export type AdminMediaRequestStatusChangeEvent = {
  request: RequestEntity;
  status: RequestStatus;
};

export type AdminUserRejectedEvent = {
  user: UserEntity;
};

export type AdminUserAcceptedEvent = {
  user: UserEntity;
};

export type AdminEvents = {
  userAccepted: AdminUserAcceptedEvent;
  userRejected: AdminUserRejectedEvent;
  mediaRequestStatusChange: AdminMediaRequestStatusChangeEvent;
};

function setEmbedField(embed: EmbedBuilder, request: RequestEntity): EmbedBuilder {
  const media = request.media!;
  embed
    .setTitle(`${media.title} (${media.year})`)
    .setURL(`https://www.imdb.com/fr/title/${media.imdbId}/`)
    .setFields({ name: 'Status', value: `${EMOJI_BY_STATUS[request.status]} ${LABEL_BY_STATUS[request.status]}` });

  if (media.type === 'episode') {
    embed.addFields(
      { name: 'Saisons', value: `${media.seasonNumber}`, inline: true },
      { name: 'Episode', value: `${media.episodeNumber}`, inline: true },
    );
  }

  if (request.status === 'pending') {
    const users = request.userRequests?.map((user) => user.user!);
    embed.addFields({ name: 'Utilisateurs', value: users?.map((user) => user.name).join(', ') ?? 'N/A' });
  }

  return embed;
}

export class DiscordAdminMessaging extends Emitter<AdminEvents> implements OnModuleInit {
  private static readonly logger = new Logger(DiscordAdminMessaging.name);

  static async create(
    config: Config,
    discordService: DiscordService,
    mediasRepository: MediasRepository,
    requestsRepository: RequestsRepository,
    usersRepository: UsersRepository,
  ): Promise<DiscordAdminMessaging> {
    const channel = await discordService.getChannel(config.channelId);
    if (channel.type !== ChannelType.GuildText) {
      throw new Error(`Channel with ID ${config.channelId} is not a text channel`);
    }
    return new DiscordAdminMessaging(
      config,
      discordService,
      channel as TextChannel,
      mediasRepository,
      requestsRepository,
      usersRepository,
    );
  }

  private constructor(
    private readonly config: Config,
    private readonly discordService: DiscordService,
    private readonly channel: TextChannel,
    private readonly mediasRepository: MediasRepository,
    private readonly requestsRepository: RequestsRepository,
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

      const mediaRequest = await this.requestsRepository.getByThreadId(messageId);
      if (mediaRequest) {
        this.onMediaRequestReact(mediaRequest, reaction);
        return;
      }

      const user = await this.usersRepository.getByApprovalMessageId(messageId);
      if (user) {
        this.onUserRequestReact(user, reaction);
        return;
      }
    });
  }

  private async onMediaRequestReact(request: RequestEntity, reaction: string): Promise<void> {
    const status = MEDIA_REQUEST_STATUS_BY_REACTION[reaction as keyof typeof MEDIA_REQUEST_STATUS_BY_REACTION];
    if (!status) {
      DiscordAdminMessaging.logger.warn(`Unknown reaction ${reaction} for media request ${request.threadId}`);
      return;
    }

    this.emit('mediaRequestStatusChange', { request, status });
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

  async newMediaRequest(request: RequestEntity): Promise<RequestEntity> {
    // const media = request.media!;
    // const embed = new EmbedBuilder().setColor('#3498db');

    // const message = await this.channel.send({ embeds: [setEmbedField(embed, request)] });

    // const thread = await message.startThread({
    //   name: `Suivi: ${media.title} (${media.year})`,
    //   autoArchiveDuration: ThreadAutoArchiveDuration.OneWeek,
    // });

    // await this.requestsRepository.attachThread(media.id, thread.id);

    return request;
  }

  async updateMediaStatus(request: RequestEntity): Promise<void> {
    // if (!request.threadId) {
    //   await this.newMediaRequest(request);
    //   return;
    // }

    // const thread = await DiscordService.getThread(this.channel, request.threadId);
    // await thread.send(`Statut mis à jour: ${EMOJI_BY_STATUS[request.status]} ${LABEL_BY_STATUS[request.status]}`);

    // const head = await DiscordService.getHeadOfThread(this.channel, request.threadId);

    // await head.edit({ embeds: [setEmbedField(EmbedBuilder.from(head.embeds[0]), request)] });
  }
}
