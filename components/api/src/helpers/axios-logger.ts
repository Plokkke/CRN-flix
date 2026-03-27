import { Logger } from '@nestjs/common';
import { AxiosError, AxiosResponse, InternalAxiosRequestConfig } from 'axios';

function formatUrl(config: InternalAxiosRequestConfig): string {
  const base = config.baseURL ?? '';
  const url = config.url ?? '';
  const params = config.params ? `?${new URLSearchParams(config.params).toString()}` : '';
  return `${base}${url}${params}`;
}

export function logAxiosRequest(logger: Logger, config: InternalAxiosRequestConfig): void {
  logger.debug(`→ ${config.method?.toUpperCase()} ${formatUrl(config)}`);
}

export function logAxiosResponse(logger: Logger, response: AxiosResponse): void {
  logger.debug(`← ${response.status} ${response.config.method?.toUpperCase()} ${formatUrl(response.config)}`);
}

export function logAxiosError(logger: Logger, error: AxiosError): void {
  const config = error.config;
  const url = config ? formatUrl(config) : 'unknown';
  const method = config?.method?.toUpperCase() ?? '?';

  if (error.response) {
    const body =
      typeof error.response.data === 'string'
        ? error.response.data.slice(0, 500)
        : JSON.stringify(error.response.data)?.slice(0, 500);
    logger.error(`← ${error.response.status} ${method} ${url} — ${body}`);
  } else if (error.code) {
    logger.error(`✕ ${method} ${url} — ${error.code}: ${error.message}`);
  } else {
    logger.error(`✕ ${method} ${url} — ${error.message}`);
  }
}
