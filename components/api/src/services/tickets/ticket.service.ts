import { Logger } from '@nestjs/common';

import { TicketsRepository } from '@/services/database/tickets';
import {
  OPERATIONS_BY_CATEGORY,
  OperationOutcome,
  TicketCategory,
  TicketCategoryHandler,
  TicketEntity,
  TicketEventKind,
  TicketOperation,
  TicketPayloadMap,
  TicketStatus,
  TicketSubject,
} from '@/services/tickets/model';

export const SYSTEM_ACTOR = 'system';

function describeOperation(operation: TicketOperation): string {
  switch (operation.kind) {
    case 'submitImdb':
      return `IMDb soumis : ${operation.imdbId}`;
    case 'submitLink':
      return `Lien soumis : ${operation.url}`;
    case 'approve':
      return 'Approbation';
    case 'reject':
      return 'Rejet';
    case 'restore':
      return 'Restauration';
    case 'resolveManually':
      return `Résolution manuelle : ${operation.note}`;
  }
}

export class TicketService {
  private static readonly logger = new Logger(TicketService.name);

  private readonly handlers = new Map<TicketCategory, TicketCategoryHandler>();

  constructor(private readonly tickets: TicketsRepository) {}

  registerHandler<C extends TicketCategory>(category: C, handler: TicketCategoryHandler<C>): void {
    this.handlers.set(category, handler as TicketCategoryHandler);
  }

  /** Idempotent: returns the already-open ticket for (category, subject) when one exists. */
  async open<C extends TicketCategory>(
    category: C,
    subject: TicketSubject,
    payload: TicketPayloadMap[C],
    view: { title: string; summary?: string },
  ): Promise<TicketEntity<C>> {
    const { ticket, created } = await this.tickets.openIdempotent({
      category,
      subject,
      title: view.title,
      summary: view.summary,
      payload,
    });
    if (created) {
      TicketService.logger.log(`Opened ticket ${ticket.id} [${category}] ${view.title}`);
      await this.tickets.addEvent(ticket.id, TicketEventKind.Created, SYSTEM_ACTOR, view.title);
    } else if (JSON.stringify(ticket.payload) !== JSON.stringify(payload)) {
      // The payload mirrors the current desired state (e.g. a missing-imdb episode list grows).
      await this.tickets.patchPayload(ticket.id, payload);
      ticket.payload = payload;
    }
    return ticket as TicketEntity<C>;
  }

  /** Single entry point for every adapter (Discord reply/button, dashboard form). */
  async applyOperation(ticketId: string, operation: TicketOperation, actor: string): Promise<OperationOutcome> {
    const ticket = await this.tickets.get(ticketId);
    if (!ticket) {
      return { status: 'failed', message: 'Ticket introuvable' };
    }
    if (ticket.status !== TicketStatus.Open) {
      return { status: 'failed', message: `Ticket déjà clos (${ticket.status})` };
    }
    if (!OPERATIONS_BY_CATEGORY[ticket.category].includes(operation.kind)) {
      return { status: 'failed', message: `Opération ${operation.kind} non applicable à ${ticket.category}` };
    }

    if (operation.kind === 'resolveManually') {
      await this.tickets.addEvent(ticketId, TicketEventKind.Operation, actor, describeOperation(operation));
      return this.settle(ticketId, actor, { status: 'resolved', message: operation.note });
    }

    await this.tickets.addEvent(ticketId, TicketEventKind.Operation, actor, describeOperation(operation));
    await this.tickets.incrementAttempts(ticketId);

    const handler = this.handlers.get(ticket.category);
    if (!handler) {
      return { status: 'failed', message: `Aucun handler pour ${ticket.category}` };
    }

    try {
      const outcome = await handler(ticket, operation, actor);
      return this.settle(ticketId, actor, outcome);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      TicketService.logger.error(`Operation ${operation.kind} on ticket ${ticketId} threw: ${message}`);
      return this.settle(ticketId, actor, { status: 'failed', message, payloadPatch: { lastError: message } });
    }
  }

  private async settle(ticketId: string, actor: string, outcome: OperationOutcome): Promise<OperationOutcome> {
    switch (outcome.status) {
      case 'resolved': {
        const closed = await this.tickets.close(ticketId, TicketStatus.Resolved, outcome.message);
        if (closed) {
          await this.tickets.addEvent(ticketId, TicketEventKind.Resolved, actor, outcome.message);
        }
        break;
      }
      case 'progress':
        if (outcome.payloadPatch) {
          await this.tickets.patchPayload(ticketId, outcome.payloadPatch);
        }
        await this.tickets.addEvent(ticketId, TicketEventKind.Note, actor, outcome.message);
        break;
      case 'failed':
        if (outcome.payloadPatch) {
          await this.tickets.patchPayload(ticketId, outcome.payloadPatch);
        }
        await this.tickets.addEvent(ticketId, TicketEventKind.AttemptFailed, actor, outcome.message);
        break;
    }
    return outcome;
  }

  /** Free-text admin message kept in the timeline (rendered by the other adapters). */
  async addAdminMessage(
    ticketId: string,
    actor: string,
    content: string,
    origin: 'discord' | 'dashboard',
  ): Promise<void> {
    await this.tickets.addEvent(ticketId, TicketEventKind.AdminMessage, actor, content, { origin });
  }

  async recordSystemEvent(ticketId: string, message: string, data: Record<string, unknown> = {}): Promise<void> {
    await this.tickets.addEvent(ticketId, TicketEventKind.Note, SYSTEM_ACTOR, message, data);
  }

  /** Timeline note on the open ticket of a subject; no-op when none is open. */
  async recordSystemEventForSubject(
    category: TicketCategory,
    subjectType: string,
    subjectId: string,
    message: string,
  ): Promise<void> {
    const ticket = await this.tickets.getOpenBySubject(category, subjectType, subjectId);
    if (ticket) {
      await this.recordSystemEvent(ticket.id, message);
    }
  }

  /** Business-event driven resolution; no-op when nothing is open for the subject. */
  async resolveBySubject(
    category: TicketCategory,
    subjectType: string,
    subjectId: string,
    resolution: string,
  ): Promise<void> {
    const ticket = await this.tickets.getOpenBySubject(category, subjectType, subjectId);
    if (!ticket) {
      return;
    }
    const closed = await this.tickets.close(ticket.id, TicketStatus.Resolved, resolution);
    if (closed) {
      await this.tickets.addEvent(ticket.id, TicketEventKind.Resolved, SYSTEM_ACTOR, resolution);
    }
  }

  async resolveById(ticketId: string, resolution: string): Promise<void> {
    const closed = await this.tickets.close(ticketId, TicketStatus.Resolved, resolution);
    if (closed) {
      await this.tickets.addEvent(ticketId, TicketEventKind.Resolved, SYSTEM_ACTOR, resolution);
    }
  }
}
