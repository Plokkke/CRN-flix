import { INestApplication, Logger } from '@nestjs/common';

const log = new Logger('Shutdown');

const DEFAULT_TIMEOUT_MS = 30000;

export type ShutdownOptions = {
  timeoutMs?: number;
  beforeClose?: () => Promise<void> | void;
};

/**
 * Install SIGTERM, SIGINT, unhandledRejection and uncaughtException handlers
 * that drain Nest's lifecycle hooks within a configurable timeout, then exit.
 * Repeated signals are ignored after the first.
 */
export function installShutdownHandlers(app: INestApplication, opts: ShutdownOptions = {}): void {
  const timeoutMs = opts.timeoutMs ?? Number(process.env.SHUTDOWN_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS);
  let shuttingDown = false;

  const shutdown = async (signal: string, code = 0): Promise<void> => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    log.log(`Received ${signal}, draining (timeout ${timeoutMs}ms)`);
    const force = setTimeout(() => {
      log.error(`Drain exceeded ${timeoutMs}ms, forcing exit`);
      process.exit(code || 1);
    }, timeoutMs);
    force.unref();
    try {
      if (opts.beforeClose) {
        await opts.beforeClose();
      }
      await app.close();
    } catch (err) {
      log.error(`app.close() failed: ${(err as Error).message}`);
    }
    clearTimeout(force);
    process.exit(code);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('unhandledRejection', (reason) => {
    log.error(`unhandledRejection: ${reason instanceof Error ? (reason.stack ?? reason.message) : String(reason)}`);
    void shutdown('unhandledRejection', 1);
  });
  process.on('uncaughtException', (err) => {
    log.error(`uncaughtException: ${err.stack ?? err.message}`);
    void shutdown('uncaughtException', 1);
  });
}
