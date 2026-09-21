import { Logger } from '@nestjs/common';
import { Message, ThreadChannel } from 'discord.js';

import { TicketsRepository } from '@/services/database/tickets';

import { DiscordAdminChannel } from './channel';
import { DISCORD_ADAPTER } from './ticket-adapter';

const FETCH_PAGE_SIZE = 100;
/** Discord refuses bulk deletion of messages older than this; they go one by one. */
const BULK_DELETE_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

export type CleanupReport = { threads: number; messages: number; kept: number };

/**
 * Wipes the admin channel down to its pinned messages (the downloads board), then drops
 * every Discord binding so the reconciler re-materializes the open tickets from scratch.
 */
export class DiscordChannelCleanup {
  private static readonly logger = new Logger(DiscordChannelCleanup.name);

  constructor(
    private readonly adminChannel: DiscordAdminChannel,
    private readonly tickets: TicketsRepository,
  ) {}

  async run(): Promise<CleanupReport> {
    const threads = await this.deleteThreads();
    const { deleted, kept } = await this.deleteMessages();
    const unbound = await this.tickets.unbindAll(DISCORD_ADAPTER);
    DiscordChannelCleanup.logger.log(
      `Admin channel cleaned: ${threads} thread(s), ${deleted} message(s) deleted, ${kept} pinned kept, ${unbound} binding(s) dropped`,
    );
    return { threads, messages: deleted, kept };
  }

  private async listThreads(): Promise<ThreadChannel[]> {
    const manager = this.adminChannel.channel.threads;
    const active = await manager.fetchActive();
    const archived = await manager.fetchArchived({ type: 'public', fetchAll: true });
    return [...active.threads.values(), ...archived.threads.values()];
  }

  private async deleteThreads(): Promise<number> {
    let count = 0;
    for (const thread of await this.listThreads()) {
      try {
        await thread.delete();
        count += 1;
      } catch (error) {
        DiscordChannelCleanup.logger.warn(
          `Failed to delete thread ${thread.id}: ${error instanceof Error ? error.message : error}`,
        );
      }
    }
    return count;
  }

  private async deleteMessages(): Promise<{ deleted: number; kept: number }> {
    const channel = this.adminChannel.channel;
    let deleted = 0;
    let kept = 0;
    let before: string | undefined;

    for (;;) {
      const page = await channel.messages.fetch({ limit: FETCH_PAGE_SIZE, before });
      if (page.size === 0) {
        return { deleted, kept };
      }
      const [pinned, doomed] = [page.filter((m) => m.pinned), page.filter((m) => !m.pinned)];
      kept += pinned.size;
      deleted += await this.deleteBatch([...doomed.values()]);
      before = page.last()?.id;
    }
  }

  private async deleteBatch(messages: Message[]): Promise<number> {
    const threshold = Date.now() - BULK_DELETE_MAX_AGE_MS;
    const recent = messages.filter((m) => m.createdTimestamp > threshold);
    const old = messages.filter((m) => m.createdTimestamp <= threshold);

    let count = 0;
    if (recent.length > 0) {
      const bulk = await this.adminChannel.channel.bulkDelete(recent, true);
      count += bulk.size;
    }
    for (const message of old) {
      try {
        await message.delete();
        count += 1;
      } catch (error) {
        DiscordChannelCleanup.logger.warn(
          `Failed to delete message ${message.id}: ${error instanceof Error ? error.message : error}`,
        );
      }
    }
    return count;
  }
}
