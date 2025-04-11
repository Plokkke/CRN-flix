import { Logger } from '@nestjs/common';

import { MediaRequestEntity } from '@/services/database/mediaRequests';

interface QueuedItem {
  timeoutId: NodeJS.Timeout | null;
  requests: MediaRequestEntity[];
}

export class EmailQueue {
  private static readonly logger = new Logger(EmailQueue.name);
  private static readonly DEBOUNCE_THRESHOLD = 60 * 1000;

  private queue: Map<string, QueuedItem> = new Map();

  constructor(private readonly sendEmail: (email: string, requests: MediaRequestEntity[]) => Promise<void>) {}

  async addToQueue(email: string, request: MediaRequestEntity): Promise<void> {
    let queuedItem = this.queue.get(email);

    if (!queuedItem) {
      queuedItem = { timeoutId: null, requests: [] };
      this.queue.set(email, queuedItem);
    } else if (queuedItem.timeoutId) {
      clearTimeout(queuedItem.timeoutId);
    }
    queuedItem.timeoutId = setTimeout(() => this.processKey(email), EmailQueue.DEBOUNCE_THRESHOLD);

    const existingIndex = queuedItem.requests.findIndex((q) => q.id === request.id);
    if (existingIndex === -1) {
      queuedItem.requests.push(request);
    } else {
      queuedItem.requests[existingIndex] = request;
    }
  }

  private async processKey(email: string): Promise<void> {
    const queuedItem = this.queue.get(email);
    if (!queuedItem) {
      return;
    }

    await this.sendEmail(email, queuedItem.requests);
    this.queue.delete(email);
  }
}
