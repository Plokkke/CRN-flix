import { Logger } from '@nestjs/common';
import { PoolClient, Pool, Notification } from 'pg';
import { z } from 'zod';

export function upsertQuery(table: string, record: Record<string, unknown>): string;
export function upsertQuery(table: string, record: Record<string, unknown>, primaryKeys: string[]): string;
export function upsertQuery(schema: string, table: string, record: Record<string, unknown>): string;
export function upsertQuery(
  schema: string,
  table: string,
  record: Record<string, unknown>,
  primaryKeys: string[],
): string;

export function upsertQuery(
  ...args:
    | [string, string, Record<string, unknown>]
    | [string, string, Record<string, unknown>, string[]]
    | [string, Record<string, unknown>]
    | [string, Record<string, unknown>, string[]]
): string {
  const schema = typeof args[1] === 'string' ? (args[0] as string) : 'public';
  const table = typeof args[1] === 'string' ? (args[1] as string) : args[0];
  const record = (typeof args[1] === 'string' ? args[2] : args[1]) as Record<string, unknown>;
  const columns = Object.keys(record);
  const primaryKeys = Array.isArray(args[args.length - 1]) ? (args[args.length - 1] as string[]) : undefined;

  let conflictClause = '';
  if (primaryKeys && primaryKeys.length > 0) {
    const secondaryKeys = columns.filter((key) => !primaryKeys.includes(key));
    if (secondaryKeys.length > 0) {
      conflictClause = ` ON CONFLICT (${primaryKeys.join(',')}) DO UPDATE SET ${secondaryKeys.map((key) => `"${key}" = EXCLUDED."${key}"`).join(',')}`;
    } else {
      conflictClause = ` ON CONFLICT (${primaryKeys.join(',')}) DO NOTHING`;
    }
  }

  const query = `INSERT INTO "${schema}"."${table}" ("${columns.join('","')}")
       VALUES (${columns.map((key, index) => `$${index + 1}`).join(',')})
       ${conflictClause}
       RETURNING *`;
  return query;
}

export async function transaction(pool: Pool, runner: (client: PoolClient) => Promise<void>): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await runner(client);

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export function listen<T>(
  client: PoolClient,
  channel: string,
  schema: z.ZodType<T>,
  callback: (payload: T) => void,
): void {
  client.on('notification', (msg: Notification): void => {
    if (msg.channel === channel) {
      const parsing = schema.safeParse(msg.payload);
      if (parsing.success === false) {
        Logger.error(`Failed to parse payload ${msg.payload} for channel ${channel}`);
        return;
      }
      callback(parsing.data);
      return;
    }
  });

  client.query(`LISTEN ${channel}`);
}

export type ListenChannel<T = unknown> = {
  channel: string;
  schema: z.ZodType<T>;
  callback: (payload: T) => void;
};

export type ListenHandle = {
  close(): Promise<void>;
};

const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 30000;

/**
 * Listen on multiple PostgreSQL NOTIFY channels with auto-reconnect.
 * On connection drop, reacquires a client, re-subscribes, and invokes onReconnect (e.g. to replay missed events).
 */
export function listenWithReconnect(
  pool: Pool,
  channels: ListenChannel[],
  onReconnect?: () => Promise<void>,
  loggerName = 'ListenWithReconnect',
): ListenHandle {
  const logger = new Logger(loggerName);
  let client: PoolClient | null = null;
  let stopped = false;
  let reconnectTimer: NodeJS.Timeout | null = null;
  let reconnectAttempt = 0;
  let hasConnectedOnce = false;

  const onNotification = (msg: Notification): void => {
    const def = channels.find((c) => c.channel === msg.channel);
    if (!def) {
      return;
    }
    const parsed = def.schema.safeParse(msg.payload);
    if (!parsed.success) {
      logger.error(`Failed to parse payload "${msg.payload}" for channel ${def.channel}`);
      return;
    }
    def.callback(parsed.data);
  };

  const detach = (c: PoolClient): void => {
    c.removeAllListeners('notification');
    c.removeAllListeners('error');
    c.removeAllListeners('end');
  };

  const connect = async (): Promise<void> => {
    if (stopped) {
      return;
    }
    try {
      client = await pool.connect();
      reconnectAttempt = 0;
      client.on('notification', onNotification);
      client.on('error', (err) => {
        logger.error(`Listen client error: ${err.message}`);
        if (client) {
          detach(client);
          try {
            client.release(err);
          } catch {
            /* ignore */
          }
          client = null;
        }
        scheduleReconnect();
      });
      client.on('end', () => {
        logger.warn('Listen client ended');
        if (client) {
          detach(client);
          client = null;
        }
        scheduleReconnect();
      });
      for (const { channel } of channels) {
        await client.query(`LISTEN ${channel}`);
        logger.log(`Subscribed to PostgreSQL channel: ${channel}`);
      }
      const wasReconnect = hasConnectedOnce;
      hasConnectedOnce = true;
      if (wasReconnect && onReconnect) {
        try {
          await onReconnect();
        } catch (err) {
          logger.error(`onReconnect callback failed: ${(err as Error).message}`);
        }
      }
    } catch (err) {
      logger.error(`Failed to acquire listen client: ${(err as Error).message}`);
      scheduleReconnect();
    }
  };

  function scheduleReconnect(): void {
    if (stopped || reconnectTimer) {
      return;
    }
    const delay = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** reconnectAttempt) * (0.5 + Math.random());
    reconnectAttempt += 1;
    logger.warn(`Listen client lost, reconnecting in ${Math.round(delay)}ms (attempt ${reconnectAttempt})`);
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      void connect();
    }, delay);
  }

  void connect();

  return {
    async close(): Promise<void> {
      stopped = true;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      if (client) {
        detach(client);
        try {
          client.release();
        } catch {
          /* ignore */
        }
        client = null;
      }
    },
  };
}
