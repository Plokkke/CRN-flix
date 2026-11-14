import { COLORS, escapeHtml } from '@crn-flix/design-system';

import { TicketEntity, TicketStatus, TicketView } from '@/services/tickets/model';
import { adminPage } from '@/web/templates/admin-page';

export type TicketListFilter = 'open' | 'dead-letter' | 'closed';

export type TicketListItem = { ticket: TicketEntity; view: TicketView };

interface AdminTicketsParams {
  serviceName: string;
  filter: TicketListFilter;
  items: TicketListItem[];
  flashMessage?: string;
}

const FILTERS: { key: TicketListFilter; label: string }[] = [
  { key: 'open', label: 'Ouverts' },
  { key: 'dead-letter', label: 'Dead-letter' },
  { key: 'closed', label: 'Résolus récents' },
];

const TONE_CLASSES: Record<TicketView['tone'], string> = {
  danger: 'tone-danger',
  warning: 'tone-warning',
  info: 'tone-info',
  muted: 'tone-muted',
  success: 'tone-success',
};

function ticketRow({ ticket, view }: TicketListItem): string {
  const statusLabel = ticket.status === TicketStatus.Open ? `${ticket.attempts} tentative(s)` : ticket.status;
  return `
    <a class="ticket-card ${TONE_CLASSES[view.tone]}" href="/admin/tickets/${ticket.id}">
      <div class="ticket-title">${escapeHtml(view.title)}</div>
      <div class="ticket-meta">
        <span class="ticket-category">${escapeHtml(ticket.category)}</span>
        <span>${escapeHtml(statusLabel)}</span>
        <span>${ticket.createdAt.toISOString().slice(0, 16).replace('T', ' ')}</span>
      </div>
    </a>
  `;
}

export const adminTicketsTemplate = (params: AdminTicketsParams): string => {
  const { serviceName, filter, items, flashMessage } = params;

  const tabs = FILTERS.map(
    ({ key, label }) =>
      `<a class="filter-tab ${key === filter ? 'active' : ''}" href="/admin/tickets?filter=${key}">${label}</a>`,
  ).join('');

  const list =
    items.length === 0 ? `<p class="empty-state">Aucun ticket.</p>` : items.map((item) => ticketRow(item)).join('');

  const content = `
    ${flashMessage ? `<div class="flash-message">${escapeHtml(flashMessage)}</div>` : ''}
    <p><a href="/admin">← Dashboard</a></p>
    <h2>🎫 Tickets</h2>
    <form class="manual-download" method="POST" action="/admin/tickets/manual-download">
      <input type="url" name="url" placeholder="Lien à télécharger (comme un lien posté dans le salon admin)" required />
      <button type="submit">📥 Téléchargement manuel</button>
    </form>
    <div class="filter-tabs">${tabs}</div>
    <div class="tickets-list">${list}</div>
  `;

  const additionalCSS = `
    .container { max-width: 900px; }
    h2 { color: var(--text); margin: 20px 0 15px 0; font-size: 20px; }
    .manual-download { display: flex; gap: 8px; margin-bottom: 16px; }
    .manual-download input { flex: 1; padding: 8px; border: 1px solid var(--border); border-radius: 4px; background: var(--surface); color: var(--text); }
    .manual-download button { width: auto; padding: 8px 16px; }

    .flash-message {
      background-color: var(--tone-info-bg); padding: 12px 16px; border-left: 4px solid ${COLORS.info};
      border-radius: 4px; margin-bottom: 20px; color: var(--text);
    }

    .filter-tabs { display: flex; gap: 8px; margin-bottom: 20px; }
    .filter-tab {
      padding: 6px 16px; border-radius: 4px; background-color: var(--tone-neutral-bg); color: var(--text-muted);
      text-decoration: none; font-size: 14px; font-weight: bold;
    }
    .filter-tab.active { background-color: ${COLORS.info}; color: #fff; }

    .tickets-list { display: flex; flex-direction: column; gap: 10px; }
    .ticket-card {
      display: block; border: 1px solid var(--border); border-left-width: 4px; border-radius: 8px;
      padding: 14px 16px; background: var(--surface-raised); text-decoration: none; color: var(--text);
    }
    .ticket-card:hover { background: var(--surface-raised); }
    .ticket-title { font-weight: bold; margin-bottom: 6px; color: var(--text); }
    .ticket-meta { display: flex; gap: 16px; font-size: 13px; color: var(--text-muted); }
    .ticket-category {
      background-color: var(--tone-neutral-bg); padding: 1px 8px; border-radius: 10px; font-size: 12px; color: var(--text-light);
    }

    .tone-danger { border-left-color: ${COLORS.error}; }
    .tone-warning { border-left-color: ${COLORS.warning}; }
    .tone-info { border-left-color: ${COLORS.info}; }
    .tone-muted { border-left-color: var(--border); }
    .tone-success { border-left-color: ${COLORS.success}; }

    .empty-state { color: var(--text-muted); font-style: italic; }
  `;

  return adminPage(`Tickets - ${serviceName}`, serviceName, content, additionalCSS);
};
