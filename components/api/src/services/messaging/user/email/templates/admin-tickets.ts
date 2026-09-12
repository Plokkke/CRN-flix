import { TicketEntity, TicketStatus, TicketView } from '@/services/tickets/model';

import { COLORS, escapeHtml, getWebTemplate } from './email-styles';

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
    <div class="filter-tabs">${tabs}</div>
    <div class="tickets-list">${list}</div>
  `;

  const additionalCSS = `
    .container { max-width: 900px; background-color: #1a1a2e; color: #e0e0e0; }
    body { background-color: #0f0f1a; color: #e0e0e0; }
    .header { background-color: #16162a; }
    h2 { color: #e0e0e0; margin: 20px 0 15px 0; font-size: 20px; }
    a { color: ${COLORS.info}; }

    .flash-message {
      background-color: #1e2a3a; padding: 12px 16px; border-left: 4px solid ${COLORS.info};
      border-radius: 4px; margin-bottom: 20px; color: #e0e0e0;
    }

    .filter-tabs { display: flex; gap: 8px; margin-bottom: 20px; }
    .filter-tab {
      padding: 6px 16px; border-radius: 4px; background-color: #2a2a3e; color: #888;
      text-decoration: none; font-size: 14px; font-weight: bold;
    }
    .filter-tab.active { background-color: ${COLORS.info}; color: #fff; }

    .tickets-list { display: flex; flex-direction: column; gap: 10px; }
    .ticket-card {
      display: block; border: 1px solid #2a2a3e; border-left-width: 4px; border-radius: 8px;
      padding: 14px 16px; background: #22223a; text-decoration: none; color: #e0e0e0;
    }
    .ticket-card:hover { background: #26264a; }
    .ticket-title { font-weight: bold; margin-bottom: 6px; color: #e0e0e0; }
    .ticket-meta { display: flex; gap: 16px; font-size: 13px; color: #888; }
    .ticket-category {
      background-color: #2a2a3e; padding: 1px 8px; border-radius: 10px; font-size: 12px; color: #ccc;
    }

    .tone-danger { border-left-color: ${COLORS.error}; }
    .tone-warning { border-left-color: ${COLORS.warning}; }
    .tone-info { border-left-color: ${COLORS.info}; }
    .tone-muted { border-left-color: #555; }
    .tone-success { border-left-color: ${COLORS.success}; }

    .empty-state { color: #666; font-style: italic; }
  `;

  return getWebTemplate(`Tickets - ${serviceName}`, serviceName, content, additionalCSS);
};
