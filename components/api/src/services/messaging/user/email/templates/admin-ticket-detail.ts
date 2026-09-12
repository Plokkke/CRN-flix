import { TicketEntity, TicketEventEntity, TicketView } from '@/services/tickets/model';

import { COLORS, escapeHtml, getWebTemplate, renderRichText } from './email-styles';
import { operationForm } from './ticket-controls';

interface AdminTicketDetailParams {
  serviceName: string;
  ticket: TicketEntity;
  view: TicketView;
  events: TicketEventEntity[];
  flashMessage?: string;
}

const TONE_COLORS: Record<TicketView['tone'], string> = {
  danger: COLORS.error,
  warning: COLORS.warning,
  info: COLORS.info,
  muted: '#555',
  success: COLORS.success,
};

function timeline(events: TicketEventEntity[]): string {
  if (events.length === 0) {
    return `<p class="empty-state">Aucun événement.</p>`;
  }
  return events
    .map(
      (event) => `
      <div class="event event-${event.kind}">
        <div class="event-head">
          <span class="event-kind">${escapeHtml(event.kind)}</span>
          <span class="event-actor">${escapeHtml(event.actor)}</span>
          <span class="event-date">${event.createdAt.toISOString().slice(0, 16).replace('T', ' ')}</span>
        </div>
        <div class="event-message">${renderRichText(event.message)}</div>
      </div>
    `,
    )
    .join('');
}

export const adminTicketDetailTemplate = (params: AdminTicketDetailParams): string => {
  const { serviceName, ticket, view, events, flashMessage } = params;

  const fields = view.fields
    .map(
      (field) => `
      <div class="field">
        <div class="field-name">${escapeHtml(field.name)}</div>
        <div class="field-value">${renderRichText(field.value)}</div>
      </div>
    `,
    )
    .join('');

  const forms = view.operations.map((operation) => operationForm(ticket.id, operation)).join('');

  const content = `
    ${flashMessage ? `<div class="flash-message">${escapeHtml(flashMessage)}</div>` : ''}
    <p><a href="/admin/tickets">← Tickets</a></p>
    <h2 style="border-left: 4px solid ${TONE_COLORS[view.tone]}; padding-left: 12px;">${escapeHtml(view.title)}</h2>
    <div class="ticket-meta">
      <span class="ticket-category">${escapeHtml(ticket.category)}</span>
      <span>Statut : ${escapeHtml(ticket.status)}</span>
      <span>${ticket.attempts} tentative(s)</span>
    </div>
    <div class="fields">${fields}</div>
    ${view.footer ? `<p class="footer-hint">${escapeHtml(view.footer)}</p>` : ''}
    ${forms ? `<h2>Actions</h2><div class="op-forms">${forms}</div>` : ''}
    <h2>Timeline</h2>
    <div class="timeline">${timeline(events)}</div>
  `;

  const additionalCSS = `
    .container { max-width: 900px; background-color: #1a1a2e; color: #e0e0e0; }
    body { background-color: #0f0f1a; color: #e0e0e0; }
    .header { background-color: #16162a; }
    h2 { color: #e0e0e0; margin: 24px 0 12px 0; font-size: 20px; }
    a { color: ${COLORS.info}; }

    .flash-message {
      background-color: #1e2a3a; padding: 12px 16px; border-left: 4px solid ${COLORS.info};
      border-radius: 4px; margin-bottom: 20px; color: #e0e0e0;
    }

    .ticket-meta { display: flex; gap: 16px; font-size: 13px; color: #888; margin-bottom: 16px; }
    .ticket-category {
      background-color: #2a2a3e; padding: 1px 8px; border-radius: 10px; font-size: 12px; color: #ccc;
    }

    .fields { display: flex; flex-direction: column; gap: 8px; }
    .field { display: flex; gap: 12px; font-size: 14px; }
    .field-name { color: #888; min-width: 180px; }
    .field-value { color: #e0e0e0; white-space: pre-wrap; word-break: break-all; }
    .footer-hint { color: #888; font-style: italic; font-size: 13px; margin-top: 12px; }

    .op-forms { display: flex; flex-direction: column; gap: 10px; }
    .op-form { display: flex; gap: 8px; align-items: center; }
    .op-form input[type=text], .op-form input[type=url] {
      flex: 1; max-width: 400px; padding: 8px 12px; border-radius: 4px;
      border: 1px solid #2a2a3e; background-color: #22223a; color: #e0e0e0;
    }
    .op-form button { width: auto; padding: 8px 20px; font-size: 14px; background-color: ${COLORS.info}; }
    .op-form button.op-reject { background-color: ${COLORS.error}; }
    .op-form button.op-approve { background-color: ${COLORS.success}; }
    .op-form button.op-resolveManually { background-color: #555; }

    .timeline { display: flex; flex-direction: column; gap: 10px; }
    .event { border-left: 3px solid #2a2a3e; padding: 6px 12px; background: #22223a; border-radius: 0 6px 6px 0; }
    .event-attempt-failed { border-left-color: ${COLORS.error}; }
    .event-resolved { border-left-color: ${COLORS.success}; }
    .event-operation { border-left-color: ${COLORS.info}; }
    .event-head { display: flex; gap: 14px; font-size: 12px; color: #888; margin-bottom: 4px; }
    .event-kind { font-weight: bold; color: #ccc; }
    .event-message { font-size: 14px; color: #e0e0e0; white-space: pre-wrap; word-break: break-word; }

    .empty-state { color: #666; font-style: italic; }
  `;

  return getWebTemplate(`Ticket - ${serviceName}`, serviceName, content, additionalCSS);
};
