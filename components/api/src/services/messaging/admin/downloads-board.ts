import { Logger } from '@nestjs/common';
import { EmbedBuilder, Message, MessageFlags } from 'discord.js';

import { countActive, downloadLabel, downloadStatusLine, sortForDisplay } from '@/services/download-format';
import { LiveDownload } from '@/services/download-live-state';

import { DiscordAdminChannel } from './channel';

/** Identifies the single pinned progress message across restarts — no state to persist. */
const DOWNLOADS_TITLE = '📥 Téléchargements';
const MAX_DOWNLOAD_FIELDS = 10;

const COLORS = { active: 0x3498db, idle: 0x95a5a6 } as const;

function buildDownloadsEmbed(downloads: LiveDownload[]): EmbedBuilder {
  const active = countActive(downloads);
  const embed = new EmbedBuilder()
    .setColor(active > 0 ? COLORS.active : COLORS.idle)
    .setTitle(`${DOWNLOADS_TITLE} — ${active > 0 ? `${active} en cours` : 'aucun en cours'}`)
    .setTimestamp(new Date());

  const ordered = sortForDisplay(downloads);
  if (ordered.length === 0) {
    return embed.setDescription('Rien en file.');
  }

  for (const download of ordered.slice(0, MAX_DOWNLOAD_FIELDS)) {
    embed.addFields({
      name: downloadLabel(download).slice(0, 256),
      value: downloadStatusLine(download).slice(0, 1024),
    });
  }

  if (ordered.length > MAX_DOWNLOAD_FIELDS) {
    embed.setFooter({ text: `+ ${ordered.length - MAX_DOWNLOAD_FIELDS} autre(s)` });
  }
  return embed;
}

export class DownloadsBoard {
  private static readonly logger = new Logger(DownloadsBoard.name);

  private downloadsMessage: Message | null = null;

  constructor(private readonly adminChannel: DiscordAdminChannel) {}

  /**
   * Rewrites the single pinned progress message. Editing never notifies on Discord, so this
   * can run on a timer without ever pinging the admins on mobile.
   */
  async refresh(downloads: LiveDownload[]): Promise<void> {
    const embed = buildDownloadsEmbed(downloads);

    try {
      const message = await this.resolveDownloadsMessage();
      await message.edit({ embeds: [embed] });
    } catch (error) {
      // The message was most likely deleted by hand; drop the cache and rebuild it next tick.
      this.downloadsMessage = null;
      DownloadsBoard.logger.error(
        `Failed to refresh the downloads message: ${error instanceof Error ? error.message : error}`,
      );
    }
  }

  private async resolveDownloadsMessage(): Promise<Message> {
    if (this.downloadsMessage) {
      return this.downloadsMessage;
    }

    const channel = this.adminChannel.channel;
    const { items } = await channel.messages.fetchPins();
    const existing = items.find(
      ({ message }) =>
        message.author.id === channel.client.user.id && !!message.embeds[0]?.title?.startsWith(DOWNLOADS_TITLE),
    )?.message;

    this.downloadsMessage = existing ?? (await this.createDownloadsMessage());
    return this.downloadsMessage;
  }

  private async createDownloadsMessage(): Promise<Message> {
    const message = await this.adminChannel.send({
      embeds: [buildDownloadsEmbed([])],
      flags: MessageFlags.SuppressNotifications,
    });

    try {
      await message.pin();
    } catch (error) {
      DownloadsBoard.logger.warn(
        `Downloads message created but could not be pinned (ManageMessages permission?): ${error instanceof Error ? error.message : error}`,
      );
    }

    DownloadsBoard.logger.log(`Downloads progress message created (${message.id})`);
    return message;
  }
}
