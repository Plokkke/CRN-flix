import { Logger, OnModuleInit } from '@nestjs/common';

import { TicketsRepository } from '@/services/database/tickets';
import { TicketCategory, TicketPayloadMap } from '@/services/tickets/model';
import { TicketService } from '@/services/tickets/ticket.service';

import { isIncompatibilityError } from './classify';

/** A ticket stays open until the call has kept working this long: one bad title must not flap it. */
const QUIET_PERIOD_MS = 60 * 60 * 1000;
const SUBJECT_TYPE = 'integration';

type IncidentPayload = TicketPayloadMap[TicketCategory.IntegrationFailure];
type OpenIncident = { ticketId: string; payload: IncidentPayload; lastFailureAt: number; lastEventAt: number };

export type IntegrationTracker = {
  track<T>(integration: string, operation: string, run: () => Promise<T>): Promise<T>;
};

const describeError = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/**
 * Summons the admin when an integration stops matching its API (one `integration-failure`
 * ticket per integration × operation) and closes the ticket once the call works again.
 * Unavailability is left to the callers' logs: nobody can act on it.
 */
export class IntegrationMonitor implements IntegrationTracker, OnModuleInit {
  private static readonly logger = new Logger(IntegrationMonitor.name);

  private readonly incidents = new Map<string, OpenIncident>();

  constructor(
    private readonly tickets: TicketsRepository,
    private readonly ticketService: TicketService,
    private readonly now: () => number = Date.now,
  ) {}

  async onModuleInit(): Promise<void> {
    const open = await this.tickets.listOpen();
    open
      .filter((ticket) => ticket.category === TicketCategory.IntegrationFailure && ticket.subjectId)
      .forEach((ticket) => {
        const at = ticket.updatedAt.getTime();
        const payload = ticket.payload as IncidentPayload;
        this.incidents.set(ticket.subjectId!, { ticketId: ticket.id, payload, lastFailureAt: at, lastEventAt: at });
      });
  }

  /** Runs the call, reports its outcome and hands its result or error back untouched. */
  async track<T>(integration: string, operation: string, run: () => Promise<T>): Promise<T> {
    let result: T;
    try {
      result = await run();
    } catch (error) {
      await this.failed(integration, operation, error);
      throw error;
    }
    await this.succeeded(integration, operation);
    return result;
  }

  async failed(integration: string, operation: string, error: unknown): Promise<void> {
    if (!isIncompatibilityError(error)) {
      return;
    }
    const key = `${integration}:${operation}`;
    const now = this.now();
    const incident = this.incidents.get(key);
    try {
      if (incident) {
        incident.lastFailureAt = now;
        await this.remind(key, incident, describeError(error), now);
      } else {
        const payload = {
          integration,
          operation,
          errorMessage: describeError(error),
          firstSeenAt: new Date(now).toISOString(),
        };
        const ticketId = await this.open(key, payload);
        this.incidents.set(key, { ticketId, payload, lastFailureAt: now, lastEventAt: now });
        IntegrationMonitor.logger.warn(`${key} no longer matches its API: ${payload.errorMessage}`);
      }
    } catch (failure) {
      IntegrationMonitor.logger.error(`Could not report ${key} incompatibility: ${describeError(failure)}`);
    }
  }

  async succeeded(integration: string, operation: string): Promise<void> {
    const key = `${integration}:${operation}`;
    const incident = this.incidents.get(key);
    if (!incident || this.now() - incident.lastFailureAt < QUIET_PERIOD_MS) {
      return;
    }
    this.incidents.delete(key);
    try {
      await this.ticketService.resolveById(incident.ticketId, 'Appel de nouveau compatible depuis une heure');
    } catch (failure) {
      this.incidents.set(key, incident);
      IntegrationMonitor.logger.error(`Could not resolve ${key} incident: ${describeError(failure)}`);
    }
  }

  private async open(key: string, payload: IncidentPayload): Promise<string> {
    const ticket = await this.ticketService.open(
      TicketCategory.IntegrationFailure,
      { type: SUBJECT_TYPE, id: key },
      payload,
      { title: `${payload.integration} — ${payload.operation} incompatible`, summary: payload.errorMessage },
    );
    return ticket.id;
  }

  /**
   * At most one timeline entry per quiet period while it keeps failing. Goes through the
   * idempotent open: an admin who closed the ticket meanwhile gets a new one.
   */
  private async remind(key: string, incident: OpenIncident, errorMessage: string, now: number): Promise<void> {
    if (now - incident.lastEventAt < QUIET_PERIOD_MS) {
      return;
    }
    incident.lastEventAt = now;
    const ticketId = await this.open(key, incident.payload);
    if (ticketId === incident.ticketId) {
      await this.ticketService.recordSystemEvent(ticketId, `Toujours incompatible : ${errorMessage}`);
    }
    incident.ticketId = ticketId;
  }
}
