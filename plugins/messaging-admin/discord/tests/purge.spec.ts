import { TextChannel } from 'discord.js';

import { purgeChannel } from '../src/purge';

const DAY_MS = 24 * 60 * 60 * 1000;

type FakeMessage = { id: string; pinned: boolean; createdTimestamp: number; delete: jest.Mock };

const message = (id: string, ageDays: number, pinned = false): FakeMessage => ({
  id,
  pinned,
  createdTimestamp: Date.now() - ageDays * DAY_MS,
  delete: jest.fn().mockResolvedValue(undefined),
});

function collection(items: FakeMessage[]) {
  const map = new Map(items.map((m) => [m.id, m]));
  return {
    size: map.size,
    values: () => map.values(),
    last: () => items[items.length - 1],
    filter: (fn: (m: FakeMessage) => boolean) => collection(items.filter(fn)),
  };
}

function setup(messages: FakeMessage[], threadIds: string[]) {
  const threads = threadIds.map((id) => ({ id, delete: jest.fn().mockResolvedValue(undefined) }));
  const fetch = jest.fn().mockResolvedValueOnce(collection(messages)).mockResolvedValue(collection([]));
  const bulkDelete = jest.fn(async (batch: FakeMessage[]) => ({ size: batch.length }));
  const channel = {
    messages: { fetch },
    bulkDelete,
    threads: {
      fetchActive: jest.fn().mockResolvedValue({ threads: new Map(threads.slice(0, 1).map((t) => [t.id, t])) }),
      fetchArchived: jest.fn().mockResolvedValue({ threads: new Map(threads.slice(1).map((t) => [t.id, t])) }),
    },
  };
  const purge = () => purgeChannel(channel as unknown as TextChannel);
  return { purge, bulkDelete, threads };
}

describe('purgeChannel', () => {
  it('keeps pinned messages, bulk-deletes recent ones and deletes old ones individually', async () => {
    const pinned = message('pin', 1, true);
    const recent = message('recent', 2);
    const old = message('old', 20);
    const { purge, bulkDelete, threads } = setup([pinned, recent, old], ['t1', 't2']);

    const report = await purge();

    expect(bulkDelete).toHaveBeenCalledWith([recent], true);
    expect(old.delete).toHaveBeenCalled();
    expect(pinned.delete).not.toHaveBeenCalled();
    expect(threads.every((t) => t.delete.mock.calls.length === 1)).toBe(true);
    expect(report).toEqual({ threads: 2, messages: 2, kept: 1 });
  });

  it('survives a message that refuses deletion', async () => {
    const stubborn = message('old', 30);
    stubborn.delete.mockRejectedValue(new Error('403'));
    const { purge } = setup([stubborn], []);

    await expect(purge()).resolves.toEqual({ threads: 0, messages: 0, kept: 0 });
  });
});
