import { Logger } from '@nestjs/common';

import { TicketsRepository } from '@/services/database/tickets';
import { AdminTicketRelay } from '@/services/messaging/admin/relay';

/** Grace period so the created-event materialization in flight is never raced. */
const MIN_AGE_MS = 60_000;

/** Re-materializes every open ticket that lost (or never got) its admin channel message. */
export class TicketReconcilerService {
  private static readonly logger = new Logger(TicketReconcilerService.name);

  constructor(
    private readonly tickets: TicketsRepository,
    private readonly relay: AdminTicketRelay,
  ) {}

  async sync(): Promise<void> {
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
}
