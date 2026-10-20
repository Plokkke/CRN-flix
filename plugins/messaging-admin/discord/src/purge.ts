import { Message, TextChannel, ThreadChannel } from 'discord.js';

import { createLogger } from '@crn-flix/contracts';

const FETCH_PAGE_SIZE = 100;
/** Discord refuses bulk deletion of messages older than this; they go one by one. */
const BULK_DELETE_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

const logger = createLogger('DiscordChannelPurge');

export type ChannelPurgeReport = { threads: number; messages: number; kept: number };

async function listThreads(channel: TextChannel): Promise<ThreadChannel[]> {
  const active = await channel.threads.fetchActive();
  const archived = await channel.threads.fetchArchived({ type: 'public', fetchAll: true });
  return [...active.threads.values(), ...archived.threads.values()];
}

async function deleteEach(items: Array<{ id: string; delete: () => Promise<unknown> }>, what: string): Promise<number> {
  let count = 0;
  for (const item of items) {
    try {
      await item.delete();
      count += 1;
    } catch (error) {
      logger.warn(`Failed to delete ${what} ${item.id}: ${error instanceof Error ? error.message : error}`);
    }
  }
  return count;
}

async function deleteBatch(channel: TextChannel, messages: Message[]): Promise<number> {
  const threshold = Date.now() - BULK_DELETE_MAX_AGE_MS;
  const recent = messages.filter((m) => m.createdTimestamp > threshold);
  const old = messages.filter((m) => m.createdTimestamp <= threshold);
  const bulk = recent.length > 0 ? (await channel.bulkDelete(recent, true)).size : 0;
  return bulk + (await deleteEach(old, 'message'));
}

async function deleteMessages(channel: TextChannel): Promise<{ deleted: number; kept: number }> {
  let deleted = 0;
  let kept = 0;
  let before: string | undefined;
  for (;;) {
    const page = await channel.messages.fetch({ limit: FETCH_PAGE_SIZE, before });
    if (page.size === 0) {
      return { deleted, kept };
    }
    kept += page.filter((m) => m.pinned).size;
    deleted += await deleteBatch(channel, [...page.filter((m) => !m.pinned).values()]);
    before = page.last()?.id;
  }
}

/** Wipes the channel down to its pinned messages (the downloads board), threads included. */
export async function purgeChannel(channel: TextChannel): Promise<ChannelPurgeReport> {
  const threads = await deleteEach(await listThreads(channel), 'thread');
  const { deleted, kept } = await deleteMessages(channel);
  logger.log(`Admin channel purged: ${threads} thread(s), ${deleted} message(s) deleted, ${kept} pinned kept`);
  return { threads, messages: deleted, kept };
}
