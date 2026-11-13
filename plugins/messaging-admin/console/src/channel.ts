import { randomUUID } from 'crypto';

import {
  AdminAcknowledgement,
  AdminChannel,
  AdminInbox,
  createLogger,
  DownloadsBoardView,
  PurgeReport,
  TicketTimelineEntry,
  TicketView,
} from '@crn-flix/contracts';

export type ConsoleAdminChannelConfig = {
  adminIds: string[];
};

/**
 * An admin channel for a local sandbox, with no external service: everything it would show
 * goes to the logs, and admins act on the web admin (`/admin/tickets`), which offers every
 * operation the real channel does. The login codes show up in the logs: never run it where
 * other people read them (the engine refuses it in production).
 */
export class ConsoleAdminChannel implements AdminChannel {
  private static readonly logger = createLogger(ConsoleAdminChannel.name);

  readonly name = 'console';
  readonly adminIds: readonly string[];

  constructor(config: ConsoleAdminChannelConfig) {
    this.adminIds = config.adminIds;
  }

  start(_inbox: AdminInbox): void {
    ConsoleAdminChannel.logger.log('Console admin channel: tickets go to the logs, answer them on /admin/tickets');
  }

  stop(): void {}

  isConnected(): boolean {
    return true;
  }

  onConnected(callback: () => void): () => void {
    setImmediate(callback);
    return () => {};
  }

  async postTicket(view: TicketView): Promise<string> {
    const ref = `console:${randomUUID()}`;
    ConsoleAdminChannel.logger.log(`Ticket ${ref} — ${view.title} [${view.operations.join(', ') || 'no operation'}]`);
    return ref;
  }

  async adoptMessage(ref: string, title: string): Promise<void> {
    ConsoleAdminChannel.logger.log(`Ticket ${ref} adopted — ${title}`);
  }

  async updateTicket(rootRef: string, view: TicketView): Promise<void> {
    ConsoleAdminChannel.logger.log(`Ticket ${rootRef} updated — ${view.title}`);
  }

  async appendToTicket(rootRef: string, entry: TicketTimelineEntry): Promise<void> {
    ConsoleAdminChannel.logger.log(`Ticket ${rootRef} · ${entry.actor} · ${entry.message}`);
  }

  async closeTicket(rootRef: string): Promise<void> {
    ConsoleAdminChannel.logger.log(`Ticket ${rootRef} closed`);
  }

  async acknowledge(ref: string, outcome: Exclude<AdminAcknowledgement, null>): Promise<void> {
    ConsoleAdminChannel.logger.log(`Message ${ref}: ${outcome}`);
  }

  /** Refreshed every 30 s: only worth a line at debug level. */
  async showDownloads(board: DownloadsBoardView): Promise<void> {
    ConsoleAdminChannel.logger.debug(`Downloads: ${board.active} active`);
  }

  async purge(): Promise<PurgeReport> {
    return { removed: 0, kept: 0 };
  }

  async notifyAdmin(adminId: string, text: string): Promise<void> {
    ConsoleAdminChannel.logger.warn(`To admin ${adminId}: ${text}`);
  }
}
