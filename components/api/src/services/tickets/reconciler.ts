import { Logger } from '@nestjs/common';

import { TicketsRepository } from '@/services/database/tickets';
import { DISCORD_ADAPTER, DiscordTicketAdapter } from '@/services/messaging/admin/ticket-adapter';

/** Grace period so the created-event materialization in flight is never raced. */
const MIN_AGE_MS = 60_000;

/** Re-materializes every open ticket that lost (or never got) its Discord message. */
export class TicketReconcilerService {
  private static readonly logger = new Logger(TicketReconcilerService.name);

  constructor(
    private readonly tickets: TicketsRepository,
    private readonly discordAdapter: DiscordTicketAdapter,
  ) {}

  async sync(): Promise<void> {
    const olderThan = new Date(Date.now() - MIN_AGE_MS);
    const orphans = await this.tickets.findOpenWithoutBinding(DISCORD_ADAPTER, 'root', olderThan);
    if (orphans.length === 0) {
      return;
    }

    TicketReconcilerService.logger.log(`Materializing ${orphans.length} unbound open ticket(s)`);
    for (const ticket of orphans) {
      await this.discordAdapter.materialize(ticket);
    }
  }
}
