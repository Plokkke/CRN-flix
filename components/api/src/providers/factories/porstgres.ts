import { Logger } from '@nestjs/common';
import { Pool } from 'pg';
import { z } from 'zod';

const log = new Logger('PostgresFactory');

export const postgresConfigSchema = z.object({
  host: z.string().optional().default('localhost'),
  port: z.number().optional().default(5432),
  database: z.string(),
  username: z.string(),
  password: z.string(),
  ssl: z.boolean().optional().default(true),
  poolSize: z.number().optional().default(20),
  idleTimeoutMillis: z.number().optional().default(30000),
  connectionTimeoutMillis: z.number().optional().default(10000),
  statementTimeoutMillis: z.number().optional().default(30000),
  queryTimeoutMillis: z.number().optional().default(30000),
  keepAlive: z.boolean().optional().default(true),
  keepAliveInitialDelayMillis: z.number().optional().default(10000),
  startupAttempts: z.number().optional().default(10),
});

export type PostgresConfig = z.infer<typeof postgresConfigSchema>;

const STARTUP_BASE_MS = 500;
const STARTUP_MAX_MS = 30000;

async function probe(pool: Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('SELECT 1');
  } finally {
    client.release();
  }
}

export async function postgresFactory(config: PostgresConfig): Promise<Pool> {
  const pool = new Pool({
    host: config.host,
    port: config.port,
    user: config.username,
    password: config.password,
    database: config.database,
    ssl: config.ssl,
    max: config.poolSize,
    idleTimeoutMillis: config.idleTimeoutMillis,
    connectionTimeoutMillis: config.connectionTimeoutMillis,
    statement_timeout: config.statementTimeoutMillis,
    query_timeout: config.queryTimeoutMillis,
    keepAlive: config.keepAlive,
    keepAliveInitialDelayMillis: config.keepAliveInitialDelayMillis,
  });

  pool.on('error', (err) => {
    log.error(`PostgreSQL pool error: ${err.message}`);
  });

  let lastError: unknown;
  for (let attempt = 1; attempt <= config.startupAttempts; attempt++) {
    try {
      await probe(pool);
      log.log(`PostgreSQL pool ready (attempt ${attempt}/${config.startupAttempts})`);
      return pool;
    } catch (err) {
      lastError = err;
      const message = err instanceof Error ? err.message : String(err);
      log.warn(`PostgreSQL probe failed (attempt ${attempt}/${config.startupAttempts}): ${message}`);
      if (attempt === config.startupAttempts) {
        break;
      }
      const delay = Math.min(STARTUP_MAX_MS, STARTUP_BASE_MS * 2 ** (attempt - 1)) * (0.5 + Math.random());
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  await pool.end().catch(() => {});
  throw lastError;
}
