import { PlannedDownloadsRepository } from '@/services/database/planned-downloads';
import { UsersRepository } from '@/services/database/users';
import { TicketCategory, TicketEntity, TicketPayloadMap } from '@/services/tickets/model';
import { TicketContext } from '@/services/tickets/presenter';

/** Loads the subject rows a ticket view needs; shared by the Discord and dashboard adapters. */
export class TicketContextLoader {
  constructor(
    private readonly plannedDownloads: PlannedDownloadsRepository,
    private readonly users: UsersRepository,
  ) {}

  async load(ticket: TicketEntity): Promise<TicketContext> {
    switch (ticket.category) {
      case TicketCategory.DownloadAction: {
        const payload = ticket.payload as TicketPayloadMap[TicketCategory.DownloadAction];
        return { action: await this.plannedDownloads.get(payload.actionId) };
      }
      case TicketCategory.UserApproval: {
        const payload = ticket.payload as TicketPayloadMap[TicketCategory.UserApproval];
        return { user: await this.users.get(payload.userId) };
      }
      default:
        return {};
    }
  }
}
