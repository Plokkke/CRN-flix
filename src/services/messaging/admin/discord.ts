import { Logger } from '@nestjs/common';
import { ChannelType, EmbedBuilder, TextChannel, ThreadAutoArchiveDuration } from 'discord.js';

import { JellyfinUser } from '@/modules/jellyfin/jellyfin';
import { MediaRequestEntity, MediaRequestRepository, RequestStatus } from '@/services/database/mediaRequests';
import { UserEntity } from '@/services/database/users';
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
  missing: 'question',
  rejected: 'x',
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

function setEmbedField(embed: EmbedBuilder, request: MediaRequestEntity) {
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

export class DiscordAdminMessaging {
  static readonly logger = new Logger(DiscordAdminMessaging.name);

  static async create(
    config: Config,
    discordService: DiscordService,
    mediaRequestRepository: MediaRequestRepository,
  ): Promise<DiscordAdminMessaging> {
    const channel = await discordService.getChannel(config.channelId);
    if (channel.type !== ChannelType.GuildText) {
      throw new Error(`Channel with ID ${config.channelId} is not a text channel`);
    }
    return new DiscordAdminMessaging(channel as TextChannel, mediaRequestRepository);
  }

  private constructor(
    private readonly channel: TextChannel,
    private readonly mediaRequestRepository: MediaRequestRepository,
  ) {}

  async newMediaRequest(request: MediaRequestEntity): Promise<MediaRequestEntity> {
    const embed = new EmbedBuilder().setColor('#3498db');

    const message = await this.channel.send({ embeds: [setEmbedField(embed, request)] });
    await message.react(EMOJI_BY_STATUS[request.status]);

    const thread = await message.startThread({
      name: `Suivi: ${request.title} (${request.year})`,
      autoArchiveDuration: ThreadAutoArchiveDuration.OneWeek,
    });

    await this.mediaRequestRepository.attachThread(request, thread.id);

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
