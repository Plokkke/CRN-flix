import { EventEmitter } from 'events';

export type CleanupCallback = () => void;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export class Listener<T extends Record<string, any> = Record<string, any>> {
  private cleanupCallbacks: CleanupCallback[] = [];

  constructor(
    protected readonly emitter: Emitter<T>,
    listeners: {
      [K in keyof T]?: (payload: T[K]) => void;
    },
  ) {
    for (const [event, callback] of Object.entries(listeners)) {
      this.registerListener(event, callback);
    }
  }

  protected registerListener<K extends keyof T>(event: K, callback: (payload: T[K]) => void): void {
    const cleanup = this.emitter.on(event, callback);
    this.cleanupCallbacks.push(cleanup);
  }

  cleanup(): void {
    this.cleanupCallbacks.forEach((cleanup) => cleanup());
    this.cleanupCallbacks = [];
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export class Emitter<T extends Record<string, any> = Record<string, any>> {
  private readonly eventEmitter = new EventEmitter();

  protected emit<K extends keyof T>(event: K, payload: T[K]): void {
    this.eventEmitter.emit(event as string, payload);
  }

  on<K extends keyof T>(event: K, listener: (payload: T[K]) => void): CleanupCallback {
    this.eventEmitter.on(event as string, listener);
    return () => this.eventEmitter.off(event as string, listener);
  }

  listen(listeners: {
    [K in keyof T]?: (payload: T[K]) => void;
  }): Listener<T> {
    return new Listener(this, listeners);
  }
}
