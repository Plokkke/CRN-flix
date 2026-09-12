import { Logger } from '@nestjs/common';

import { RequestEntity } from '@/services/database/requests';

interface QueuedItem {
  timeoutId: NodeJS.Timeout | null;
  requests: RequestEntity[];
}

const DEFAULT_DEBOUNCE_MS = 60 * 1000;

/**
 * Per-recipient debounced batching: a season landing in Jellyfin produces one
 * notification listing every episode, not ten pings. Shared by the email and
 * Discord user channels.
 */
export class DebouncedRequestQueue {
  private static readonly logger = new Logger(DebouncedRequestQueue.name);

  private queue: Map<string, QueuedItem> = new Map();
  private onEmptyPromise: Promise<void> | null = null;
  private onEmptyResolve: (() => void) | null = null;

  constructor(
    private readonly flush: (key: string, requests: RequestEntity[]) => Promise<void>,
    private readonly debounceMs: number = DEFAULT_DEBOUNCE_MS,
  ) {}

  async add(key: string, request: RequestEntity): Promise<void> {
    const queuedItem = this.getOrCreateQueuedItem(key);
    this.resetProcessKeyTimeout(key, queuedItem);
    this.upsertRequest(queuedItem, request);
  }

  async onEmpty(): Promise<void> {
    if (this.queue.size) {
      await (this.onEmptyPromise || (this.onEmptyPromise = new Promise((resolve) => (this.onEmptyResolve = resolve))));
    }
  }

  private upsertRequest(queuedItem: QueuedItem, request: RequestEntity): void {
    const existingIndex = queuedItem.requests.findIndex((q) => q.mediaId === request.mediaId);
    if (existingIndex === -1) {
      queuedItem.requests.push(request);
    } else {
      queuedItem.requests[existingIndex] = request;
    }
  }

  private getOrCreateQueuedItem(key: string): QueuedItem {
    let queuedItem = this.queue.get(key);

    if (!queuedItem) {
      queuedItem = { timeoutId: null, requests: [] };
      this.queue.set(key, queuedItem);
    }

    return queuedItem;
  }

  private resetProcessKeyTimeout(key: string, queuedItem: QueuedItem): void {
    if (queuedItem.timeoutId) {
      clearTimeout(queuedItem.timeoutId);
    }
    queuedItem.timeoutId = setTimeout(() => this.processKey(key), this.debounceMs);
  }

  private checkAndResolveOnEmpty(): void {
    if (!this.queue.size) {
      this.onEmptyResolve?.();
      this.onEmptyResolve = null;
      this.onEmptyPromise = null;
    }
  }

  private async processKey(key: string): Promise<void> {
    const queuedItem = this.queue.get(key);
    if (!queuedItem) {
      return;
    }

    try {
      DebouncedRequestQueue.logger.debug(`Flushing queue for ${key} with ${queuedItem.requests.length} requests`);
      await this.flush(key, queuedItem.requests);
      DebouncedRequestQueue.logger.log(`Queue flushed successfully for ${key}`);
    } catch (error) {
      DebouncedRequestQueue.logger.error(`Failed to flush queue for ${key}`, error);
      // Don't rethrow - we don't want to crash the process
    } finally {
      this.queue.delete(key);
      this.checkAndResolveOnEmpty();
    }
  }
}
