import { Pool } from 'pg';
import { z } from 'zod';

export const postgresConfigSchema = z.object({
  host: z.string().optional().default('localhost'),
  port: z.number().optional().default(5432),
  database: z.string(),
  username: z.string(),
  password: z.string(),
  ssl: z.boolean().optional().default(true),
  poolSize: z.number().optional().default(20),
  idleTimeoutMillis: z.number().optional().default(30000),
  connectionTimeoutMillis: z.number().optional().default(2000),
});

export type PostgresConfig = z.infer<typeof postgresConfigSchema>;

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
  });

  // TODO register pool to health check module
  try {
    const client = await pool.connect();

    client.release();

    pool.on('error', (err) => {
      console.error('PostgreSQL pool error', err);
    });

    return pool;
  } catch (error) {
    console.error('Failed to connect to PostgreSQL database', error);
    throw error;
  }
}
