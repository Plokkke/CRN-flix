import { Logger } from '@nestjs/common';

const log = new Logger('DbRetry');

const RETRYABLE_PG_CODES = new Set([
  '08000',
  '08003',
  '08006',
  '08001',
  '08004',
  '57P01',
  '57P02',
  '57P03',
  '40001',
  '40P01',
]);

const RETRYABLE_NODE_CODES = new Set(['ECONNRESET', 'ETIMEDOUT', 'EPIPE', 'ECONNREFUSED', 'EAI_AGAIN']);

const RETRYABLE_MSG_PATTERNS = [
  /Connection terminated/i,
  /timeout expired/i,
  /Client has encountered a connection error/i,
];

export function isRetryableDbError(err: unknown): boolean {
  if (!err || typeof err !== 'object') {
    return false;
  }
  const e = err as { code?: string; message?: string; cause?: unknown };
  if (e.code && (RETRYABLE_PG_CODES.has(e.code) || RETRYABLE_NODE_CODES.has(e.code))) {
    return true;
  }
  if (e.message && RETRYABLE_MSG_PATTERNS.some((r) => r.test(e.message!))) {
    return true;
  }
  if (e.cause) {
    return isRetryableDbError(e.cause);
  }
  return false;
}

export type RetryOptions = {
  attempts?: number;
  baseMs?: number;
  maxMs?: number;
  label?: string;
};

export async function withDbRetry<T>(op: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const attempts = opts.attempts ?? 5;
  const base = opts.baseMs ?? 250;
  const max = opts.maxMs ?? 5000;
  const label = opts.label ?? 'db';

  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await op();
    } catch (err) {
      lastErr = err;
      if (!isRetryableDbError(err) || i === attempts - 1) {
        throw err;
      }
      const delay = Math.min(max, base * 2 ** i) * (0.5 + Math.random());
      log.warn(
        `[${label}] retryable error (attempt ${i + 1}/${attempts}) in ${Math.round(delay)}ms: ${(err as Error).message}`,
      );
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}
