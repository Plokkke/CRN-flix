import { TicketOperationKind } from '@/services/tickets/model';
import { OPERATION_LABELS } from '@/services/tickets/presenter';

/** One form per operation, posting to the ticket endpoint; shared by the ticket pages and the requests dashboard. */
export function operationForm(ticketId: string, operation: TicketOperationKind, returnTo?: string): string {
  const label = OPERATION_LABELS[operation];
  const input =
    operation === 'submitImdb'
      ? `<input type="text" name="value" placeholder="tt1234567" required pattern="tt\\d{7,}" />`
      : operation === 'submitLink'
        ? `<input type="url" name="value" placeholder="https://..." required />`
        : operation === 'resolveManually'
          ? `<input type="text" name="value" placeholder="Note de résolution" required />`
          : '';

  return `
    <form class="op-form" method="POST" action="/admin/tickets/${ticketId}/op" onclick="event.stopPropagation()">
      <input type="hidden" name="op" value="${operation}" />
      ${returnTo ? `<input type="hidden" name="returnTo" value="${returnTo}" />` : ''}
      ${input}
      <button type="submit" class="op-${operation}">${label}</button>
    </form>
  `;
}
