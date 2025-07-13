import { Logger } from '@nestjs/common';

import { RequestEntity } from '@/services/database/requests';

interface QueuedItem {
  timeoutId: NodeJS.Timeout | null;
  requests: RequestEntity[];
}

export class EmailQueue {
  private static readonly logger = new Logger(EmailQueue.name);
  private static readonly DEBOUNCE_THRESHOLD = 60 * 1000;

  private queue: Map<string, QueuedItem> = new Map();
  private onEmptyPromise: Promise<void> | null = null;
  private onEmptyResolve: (() => void) | null = null;

  constructor(private readonly sendEmail: (email: string, requests: RequestEntity[]) => Promise<void>) { }

  async addToQueue(email: string, request: RequestEntity): Promise<void> {
    const queuedItem = this.getOrCreateQueuedItem(email);
    this.resetProcessKeyTimeout(email, queuedItem);
    this.upsertRequest(queuedItem, request);
  }

  async onEmpty(): Promise<void> {
    if (this.queue.size) {
      await (this.onEmptyPromise || (this.onEmptyPromise = new Promise((resolve) => this.onEmptyResolve = resolve)));
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

  private getOrCreateQueuedItem(email: string): QueuedItem {
    let queuedItem = this.queue.get(email);

    if (!queuedItem) {
      queuedItem = { timeoutId: null, requests: [] };
      this.queue.set(email, queuedItem);
    }

    return queuedItem;
  }

  private resetProcessKeyTimeout(email: string, queuedItem: QueuedItem): void {
    if (queuedItem.timeoutId) {
      clearTimeout(queuedItem.timeoutId);
    }
    queuedItem.timeoutId = setTimeout(() => this.processKey(email), EmailQueue.DEBOUNCE_THRESHOLD);
  }

  private checkAndResolveOnEmpty() {
    if (!this.queue.size) {
      this.onEmptyResolve?.();
      this.onEmptyResolve = null;
      this.onEmptyPromise = null;
    }
  }

  private async processKey(email: string): Promise<void> {
    const queuedItem = this.queue.get(email);
    if (!queuedItem) {
      return;
    }

    try {
      EmailQueue.logger.debug(`Processing email queue for ${email} with ${queuedItem.requests.length} requests`);
      await this.sendEmail(email, queuedItem.requests);
      EmailQueue.logger.log(`Email queue processed successfully for ${email}`);
    } catch (error) {
      EmailQueue.logger.error(`Failed to process email queue for ${email}`, error);
      // Don't rethrow - we don't want to crash the process
    } finally {
      this.queue.delete(email);
      this.checkAndResolveOnEmpty();
    }
  }
}
