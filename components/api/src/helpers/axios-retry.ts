import { Logger } from '@nestjs/common';
import { AxiosError, AxiosInstance, AxiosRequestConfig } from 'axios';

const DEFAULT_RETRIES = 3;
const DEFAULT_BASE_MS = 500;
const DEFAULT_MAX_MS = 5000;

const RETRYABLE_STATUS = (status: number): boolean => status >= 500 || status === 429;
const RETRYABLE_CODES = new Set(['ECONNRESET', 'ETIMEDOUT', 'ECONNABORTED', 'ECONNREFUSED', 'EAI_AGAIN', 'EPIPE']);

const IDEMPOTENT_METHODS = new Set(['GET', 'HEAD', 'OPTIONS', 'PUT', 'DELETE']);

type RetryConfig = AxiosRequestConfig & { __retryCount?: number };

export type AxiosRetryOptions = {
  retries?: number;
  baseMs?: number;
  maxMs?: number;
  retryNonIdempotent?: boolean;
};

function shouldRetry(error: AxiosError, retryNonIdempotent: boolean): boolean {
  const method = (error.config?.method ?? 'GET').toUpperCase();
  if (!retryNonIdempotent && !IDEMPOTENT_METHODS.has(method)) {
    return false;
  }

  if (error.response) {
    return RETRYABLE_STATUS(error.response.status);
  }
  if (error.code && RETRYABLE_CODES.has(error.code)) {
    return true;
  }
  return error.message?.includes('timeout') ?? false;
}

export function applyAxiosRetry(instance: AxiosInstance, label: string, opts: AxiosRetryOptions = {}): void {
  const log = new Logger(`AxiosRetry:${label}`);
  const retries = opts.retries ?? DEFAULT_RETRIES;
  const baseMs = opts.baseMs ?? DEFAULT_BASE_MS;
  const maxMs = opts.maxMs ?? DEFAULT_MAX_MS;
  const retryNonIdempotent = opts.retryNonIdempotent ?? false;

  instance.interceptors.response.use(undefined, async (error: AxiosError) => {
    const config = error.config as RetryConfig | undefined;
    if (!config) {
      throw error;
    }
    if (!shouldRetry(error, retryNonIdempotent)) {
      throw error;
    }

    config.__retryCount = (config.__retryCount ?? 0) + 1;
    if (config.__retryCount > retries) {
      throw error;
    }

    const delay = Math.min(maxMs, baseMs * 2 ** (config.__retryCount - 1)) * (0.5 + Math.random());
    const status = error.response?.status ?? error.code ?? 'unknown';
    log.warn(`retry ${config.__retryCount}/${retries} after ${Math.round(delay)}ms (${status}): ${error.message}`);
    await new Promise((r) => setTimeout(r, delay));
    return instance.request(config);
  });
}
