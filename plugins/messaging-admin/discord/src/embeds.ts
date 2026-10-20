import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';

import {
  DownloadsBoardView,
  OPERATION_LABELS,
  TicketEventKind,
  TicketTimelineEntry,
  TicketTone,
  TicketView,
} from '@crn-flix/contracts';

import { BUTTON_BY_OPERATION } from './buttons';

/** Identifies the single pinned progress message across restarts — no state to persist. */
export const DOWNLOADS_TITLE = '📥 Téléchargements';
const BOARD_COLORS = { active: 0x3498db, idle: 0x95a5a6 } as const;

const TONE_COLORS: Record<TicketTone, number> = {
  danger: 0xe74c3c,
  warning: 0xe67e22,
  info: 0x3498db,
  muted: 0x95a5a6,
  success: 0x2ecc71,
};

const BUTTON_STYLES: Partial<Record<string, ButtonStyle>> = {
  'ticket-approve': ButtonStyle.Success,
  'ticket-reject': ButtonStyle.Danger,
  'ticket-restore': ButtonStyle.Secondary,
  'ticket-resolve': ButtonStyle.Secondary,
};

export function buildTicketEmbed(view: TicketView): EmbedBuilder {
  const embed = new EmbedBuilder().setColor(TONE_COLORS[view.tone]).setTitle(view.title.slice(0, 256));

  for (const field of view.fields) {
    embed.addFields({ name: field.name.slice(0, 256), value: field.value.slice(0, 1024) });
  }
  if (view.footer) {
    embed.setFooter({ text: view.footer.slice(0, 2048) });
  }
  return embed;
}

/** Only button-shaped operations get components; imdb/link submissions are replies. */
export function buildTicketButtons(view: TicketView): ActionRowBuilder<ButtonBuilder>[] {
  const buttons = view.operations
    .map((operation) => {
      const buttonId = BUTTON_BY_OPERATION[operation];
      if (!buttonId) {
        return null;
      }
      return new ButtonBuilder()
        .setCustomId(buttonId)
        .setLabel(OPERATION_LABELS[operation])
        .setStyle(BUTTON_STYLES[buttonId] ?? ButtonStyle.Secondary);
    })
    .filter((button): button is ButtonBuilder => button !== null);

  return buttons.length > 0 ? [new ActionRowBuilder<ButtonBuilder>().addComponents(...buttons)] : [];
}

const EVENT_PREFIXES: Record<TicketEventKind, string> = {
  [TicketEventKind.Created]: '🎫',
  [TicketEventKind.AdminMessage]: '💬',
  [TicketEventKind.Operation]: '▶️',
  [TicketEventKind.AttemptFailed]: '❌',
  [TicketEventKind.Resolved]: '✅',
  [TicketEventKind.Abandoned]: '🗑️',
  [TicketEventKind.Note]: 'ℹ️',
};

/** Timeline line posted in the ticket thread. */
export function formatTimelineEntry(entry: TicketTimelineEntry): string {
  const actor = entry.actor === 'system' ? '' : ` (${entry.actor})`;
  return `${EVENT_PREFIXES[entry.kind] ?? 'ℹ️'} ${entry.message}${actor}`.slice(0, 2000);
}

export function buildDownloadsEmbed(board: DownloadsBoardView): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setColor(board.active > 0 ? BOARD_COLORS.active : BOARD_COLORS.idle)
    .setTitle(`${DOWNLOADS_TITLE} — ${board.active > 0 ? `${board.active} en cours` : 'aucun en cours'}`)
    .setTimestamp(new Date());

  if (board.entries.length === 0) {
    return embed.setDescription('Rien en file.');
  }
  for (const entry of board.entries) {
    embed.addFields({ name: entry.label.slice(0, 256), value: entry.status.slice(0, 1024) });
  }
  if (board.hidden > 0) {
    embed.setFooter({ text: `+ ${board.hidden} autre(s)` });
  }
  return embed;
}
