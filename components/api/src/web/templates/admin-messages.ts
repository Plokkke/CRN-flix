import { escapeHtml, getWebTemplate } from '@crn-flix/design-system';

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
  'policy-refusal': 'Refus (politique)',
  'appeal-answered': 'Réponse à un appel',
};

const MESSAGES_CSS = `
  .container { max-width: 1100px; }
  h2 { color: var(--text); margin: 20px 0 15px 0; font-size: 20px; }
  .hint { font-size: 13px; color: var(--text-muted); }
  .table-wrap { overflow-x: auto; }
  table { width: 100%; border-collapse: collapse; font-size: 14px; }
  th, td { padding: 8px 10px; border-bottom: 1px solid var(--border); text-align: center; white-space: nowrap; }
  th:first-child, td:first-child { text-align: left; }
  th { color: var(--text-light); font-weight: 600; }
  .counts { font-variant-numeric: tabular-nums; }
  .last { display: block; font-size: 11px; color: var(--text-muted); }
  .empty { color: var(--text-muted); }
  .flagged { background: var(--tone-warning-bg); color: var(--tone-warning-text); font-weight: 600; }
  .flag { color: var(--tone-warning-text); }
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
  return getWebTemplate('Messages', serviceName, content, MESSAGES_CSS, '', 'dark');
};
