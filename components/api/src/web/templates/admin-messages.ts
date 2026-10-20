import { COLORS, escapeHtml, getWebTemplate } from '@crn-flix/design-system';

import { FLOOD_THRESHOLD_24H, MessageStatsCell, MessageStatsRow } from '@/services/admin/message-stats';
import { USER_MESSAGE_KINDS, UserMessageKind } from '@/services/database/user-messages';

interface AdminMessagesParams {
  serviceName: string;
  rows: MessageStatsRow[];
}

const KIND_LABELS: Record<UserMessageKind, string> = {
  welcome: 'Bienvenue',
  login: 'Connexion',
  'requests-updated': 'Demandes',
  error: 'Erreur',
  announce: 'Annonce',
  'catalog-relink': 'Reconnexion Trakt',
};

const MESSAGES_CSS = `
  .container { max-width: 1100px; background-color: #1a1a2e; color: #e0e0e0; }
  body { background-color: #0f0f1a; color: #e0e0e0; }
  .header { background-color: #16162a; }
  h2 { color: #e0e0e0; margin: 20px 0 15px 0; font-size: 20px; }
  a { color: ${COLORS.info}; }
  .hint { font-size: 13px; color: #888; }
  .table-wrap { overflow-x: auto; }
  table { width: 100%; border-collapse: collapse; font-size: 14px; }
  th, td { padding: 8px 10px; border-bottom: 1px solid #2a2a3e; text-align: center; white-space: nowrap; }
  th:first-child, td:first-child { text-align: left; }
  th { color: #aaa; font-weight: 600; }
  .counts { font-variant-numeric: tabular-nums; }
  .last { display: block; font-size: 11px; color: #777; }
  .empty { color: #555; }
  .flagged { background: rgba(255, 215, 0, 0.12); color: ${COLORS.warning}; font-weight: 600; }
  .flag { color: ${COLORS.warning}; }
`;

const formatDate = (date: Date): string =>
  date.toLocaleString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Paris',
  });

const cell = (value: MessageStatsCell | null): string =>
  value
    ? `<td class="${value.flagged ? 'flagged' : ''}" title="24 h / 7 jours / total">
        <span class="counts">${value.last24h} · ${value.last7d} · ${value.total}</span>
        <span class="last">${formatDate(value.lastSentAt)}</span>
      </td>`
    : '<td class="empty">—</td>';

const row = ({ userName, cells, flagged }: MessageStatsRow): string => `
  <tr>
    <td>${flagged ? '<span class="flag">⚠️</span> ' : ''}${escapeHtml(userName)}</td>
    ${USER_MESSAGE_KINDS.map((kind) => cell(cells[kind])).join('')}
  </tr>
`;

const table = (rows: MessageStatsRow[]): string =>
  rows.length === 0
    ? '<p class="hint">Aucun message délivré pour l\'instant.</p>'
    : `<div class="table-wrap"><table>
        <thead><tr><th>Abonné</th>${USER_MESSAGE_KINDS.map((kind) => `<th>${KIND_LABELS[kind]}</th>`).join('')}</tr></thead>
        <tbody>${rows.map(row).join('')}</tbody>
      </table></div>`;

export const adminMessagesTemplate = ({ serviceName, rows }: AdminMessagesParams): string => {
  const content = `
    <p><a href="/admin">← Dashboard</a></p>
    <h2>✉️ Messages délivrés</h2>
    <p class="hint">Par abonné et par type : dernières 24 h · 7 jours · depuis le début, puis le dernier envoi. Seuls les messages réellement délivrés comptent (rien en dry-run ni en cas d'échec). Une case est signalée au-delà de ${FLOOD_THRESHOLD_24H} envois en 24 h.</p>
    ${table(rows)}
  `;
  return getWebTemplate('Messages', serviceName, content, MESSAGES_CSS);
};
