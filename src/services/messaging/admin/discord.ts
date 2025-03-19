import { ChannelType, EmbedBuilder, Message, TextChannel, ThreadAutoArchiveDuration } from 'discord.js';

import { JellyfinUser } from '@/modules/jellyfin/jellyfin';
import { MediaRequestEntity } from '@/services/database/mediaRequests';
import { DiscordService } from '@/services/discord';

export type Config = {
  channelId: string;
};

export const REQUEST_STATUS = ['requested', 'in_progress', 'completed', 'not_found', 'unacceptable'] as const;
export type RequestStatus = (typeof REQUEST_STATUS)[number];

export const EMOJI_BY_STATUS: Record<RequestStatus, string> = {
  requested: '⏳',
  in_progress: '👀',
  completed: '✅',
  not_found: '🫥',
  unacceptable: '🚫',
} as const;
export const EMOJI_NAME_BY_STATUS: Record<RequestStatus, string> = {
  requested: 'sandglass',
  in_progress: 'eyes',
  completed: 'white_check_mark',
  not_found: 'question',
  unacceptable: 'x',
} as const;
export const LABEL_BY_STATUS: Record<RequestStatus, string> = {
  requested: 'En attente',
  in_progress: 'En cours',
  completed: 'Traité',
  not_found: 'Introuvable',
  unacceptable: 'Inacceptable',
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

export class DiscordAdminMessaging {
  static async create(discordService: DiscordService, config: Config): Promise<DiscordAdminMessaging> {
    const channel = await discordService.getChannel(config.channelId);
    if (channel.type !== ChannelType.GuildText) {
      throw new Error(`Channel with ID ${config.channelId} is not a text channel`);
    }
    return new DiscordAdminMessaging(channel as TextChannel);
  }

  private constructor(private readonly channel: TextChannel) {}

  private async updateMessageStatus(message: Message, status: RequestStatus) {
    const embed = message.embeds[0];
    const fields = embed.fields;
    const statusField = fields?.find((field) => field.name === 'Status');
    if (statusField) {
      statusField.value = `${EMOJI_BY_STATUS[status]} ${LABEL_BY_STATUS[status]}`;
    }
    await message.edit({ embeds: [embed] });
    await message.reactions.removeAll();
    await message.react(EMOJI_BY_STATUS[status]);
  }

  async newMediaRequest(request: NewRequestContext): Promise<{ threadId: string; messageId: string }> {
    const { media, users } = request;
    const embed = new EmbedBuilder()
      .setColor('#3498db')
      .setTitle(`Nouvelle demande: ${media.title}`)
      .setDescription(`Un nouveau média a été ajouté à la liste de synchronisation.`)
      .addFields(
        { name: 'ID', value: media.imdbId },
        { name: 'Type', value: media.type === 'movie' ? 'Film' : 'Série' },
        { name: 'Année', value: media.year?.toString() ?? 'N/A' },
      );

    if (media.type === 'show') {
      if (media.seasonNumber) {
        embed.addFields({ name: 'Saisons', value: `${media.seasonNumber}` });
      }
      if (media.episodeNumber) {
        embed.addFields({ name: 'Episodes', value: `${media.episodeNumber}` });
      }
    }
    embed.addFields(
      { name: 'Utilisateurs', value: users.map((user) => user.name).join(', ') },
      { name: 'Status', value: `${EMOJI_BY_STATUS.requested} ${LABEL_BY_STATUS.requested}` },
    );

    const message = await this.channel.send({ embeds: [embed] });
    await message.react(EMOJI_BY_STATUS.requested);

    const thread = await message.startThread({
      name: `Suivi: ${media.title} (${media.year})`,
      autoArchiveDuration: ThreadAutoArchiveDuration.OneWeek,
    });

    return {
      threadId: thread.id,
      messageId: message.id,
    };
  }

  async updateMediaStatus(request: RequestContext): Promise<void> {
    const { threadId, messageId, status } = request;

    const thread = await DiscordService.getThread(this.channel, threadId);
    await thread.send(`Statut mis à jour: ${EMOJI_BY_STATUS[status]} ${LABEL_BY_STATUS[status]}`);

    const message = await DiscordService.getMessage(this.channel, messageId);
    await this.updateMessageStatus(message, status);
  }
}
