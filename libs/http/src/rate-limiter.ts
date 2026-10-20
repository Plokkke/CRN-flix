/**
 * Serializes callers so that no two acquisitions start closer than `minIntervalMs`.
 * Built for hard per-token API caps where bursting is not forgiven.
 */
export class RateLimiter {
  private tail: Promise<void> = Promise.resolve();
  private lastStart = 0;

  constructor(private readonly minIntervalMs: number) {}

  /** Resolves once the caller is clear to fire its request. */
  acquire(): Promise<void> {
    const slot = this.tail.then(async () => {
      const wait = this.lastStart + this.minIntervalMs - Date.now();
      if (wait > 0) {
        await new Promise((resolve) => setTimeout(resolve, wait));
      }
      this.lastStart = Date.now();
    });

    // Keep the chain alive even if a caller rejects, so one failure cannot stall the queue.
    this.tail = slot.catch(() => undefined);
    return slot;
  }
}
