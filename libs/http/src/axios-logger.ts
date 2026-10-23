import { AxiosError, AxiosResponse, InternalAxiosRequestConfig } from 'axios';

import { PluginLogger } from '@crn-flix/contracts';

/** Query parameters that carry a credential: their value never reaches the logs. */
const SECRET_PARAM = /([?&](?:api[_-]?key|key|token|access_token|client_secret|secret|password)=)[^&#]*/gi;

export const redactUrl = (url: string): string => url.replace(SECRET_PARAM, '$1***');

function formatUrl(config: InternalAxiosRequestConfig): string {
  const base = config.baseURL ?? '';
  const url = config.url ?? '';
  const params = config.params ? `?${new URLSearchParams(config.params).toString()}` : '';
  return redactUrl(`${base}${url}${params}`);
}

export function logAxiosRequest(logger: PluginLogger, config: InternalAxiosRequestConfig): void {
  logger.debug(`→ ${config.method?.toUpperCase()} ${formatUrl(config)}`);
}

export function logAxiosResponse(logger: PluginLogger, response: AxiosResponse): void {
  logger.debug(`← ${response.status} ${response.config.method?.toUpperCase()} ${formatUrl(response.config)}`);
}

export function logAxiosError(logger: PluginLogger, error: AxiosError): void {
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
