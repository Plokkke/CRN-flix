import { Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';

import { TicketsRepository } from '@/services/database/tickets';
import { AdminTicketRelay } from '@/services/messaging/admin/relay';

/** Grace period so the created-event materialization in flight is never raced. */
const MIN_AGE_MS = 60_000;

const describeError = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/**
 * Brings the admin channel back in step with the tickets: shows the open tickets it lost (or
 * never got), takes down the closed ones it still shows, and after every (re)connection also
 * re-renders what it shows, since every update of the outage was missed.
 */
export class TicketReconcilerService implements OnModuleInit, OnModuleDestroy {
  private static readonly logger = new Logger(TicketReconcilerService.name);

  private unsubscribe: (() => void) | null = null;

  constructor(
    private readonly tickets: TicketsRepository,
    private readonly relay: AdminTicketRelay,
  ) {}

  onModuleInit(): void {
    this.unsubscribe = this.relay.onChannelConnected(() => {
      this.recover().catch((error: unknown) =>
        TicketReconcilerService.logger.error(`Ticket recovery failed: ${describeError(error)}`),
      );
    });
  }

  onModuleDestroy(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  async sync(): Promise<void> {
    await this.materializeOrphans();
    await this.takeDownClosed();
  }

  async recover(): Promise<void> {
    const shown = await this.tickets.findBound(this.relay.adapter, 'root', true);
    TicketReconcilerService.logger.log(`Admin channel connected: refreshing ${shown.length} open ticket(s)`);
    for (const ticket of shown) {
      await this.relay.refresh(ticket);
    }
    await this.sync();
  }

  private async materializeOrphans(): Promise<void> {
    const olderThan = new Date(Date.now() - MIN_AGE_MS);
    const orphans = await this.tickets.findOpenWithoutBinding(this.relay.adapter, 'root', olderThan);
    if (orphans.length === 0) {
      return;
    }
    TicketReconcilerService.logger.log(`Materializing ${orphans.length} unbound open ticket(s)`);
    for (const ticket of orphans) {
      await this.relay.materialize(ticket);
    }
  }

  private async takeDownClosed(): Promise<void> {
    const stale = await this.tickets.findBound(this.relay.adapter, 'root', false);
    if (stale.length === 0) {
      return;
    }
    TicketReconcilerService.logger.log(`Taking down ${stale.length} closed ticket(s) still shown`);
    for (const ticket of stale) {
      await this.relay.takeDown(ticket.id);
    }
  }
}
