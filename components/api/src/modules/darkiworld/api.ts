import { Logger } from '@nestjs/common';
import axios, { AxiosInstance } from 'axios';
import { z } from 'zod';

import { logAxiosError, logAxiosRequest, logAxiosResponse } from '@/helpers/axios-logger';

import { darkiworldSearchResponseSchema } from './schemas';
import { DarkiworldTitle, ListLinksOptions } from './types';

export const configSchema = z.object({
  apiKey: z.string(),
  host: z.string().min(1),
});

export type DarkiworldConfig = z.infer<typeof configSchema>;

export class DarkiworldUnparseableResponseError extends Error {
  constructor(query: string, preview: string) {
    super(`Unparseable Darkiworld response for "${query}": ${preview}`);
    this.name = 'DarkiworldUnparseableResponseError';
  }
}

export class DarkiworldApi {
  private static readonly logger = new Logger(DarkiworldApi.name);

  private readonly client: AxiosInstance;

  constructor(config: DarkiworldConfig) {
    const parsedConfig = configSchema.parse(config);

    const baseHost = parsedConfig.host.replace(/\/+$/, '');
    this.client = axios.create({
      baseURL: `${baseHost}/api/v1`,
      headers: { Accept: 'application/json' },
    });

    this.client.interceptors.request.use((request) => {
      request.headers.Authorization = `Bearer ${parsedConfig.apiKey}`;
      logAxiosRequest(DarkiworldApi.logger, request);
      return request;
    });

    this.client.interceptors.response.use(
      (response) => {
        logAxiosResponse(DarkiworldApi.logger, response);
        return response;
      },
      (error) => {
        logAxiosError(DarkiworldApi.logger, error);
        throw error;
      },
    );
  }

  async search(query: string, limit: number = 20): Promise<DarkiworldTitle[]> {
    const encodedQuery = encodeURIComponent(query);
    const response = await this.client.get(`/search/${encodedQuery}`, {
      params: { limit },
    });

    const result = darkiworldSearchResponseSchema.safeParse(response.data);
    if (!result.success) {
      const preview = typeof response.data === 'string' ? response.data.slice(0, 200) : JSON.stringify(response.data);
      throw new DarkiworldUnparseableResponseError(query, preview);
    }
    return result.data.results;
  }

  async ping(): Promise<boolean> {
    try {
      await this.search('a', 1);
      return true;
    } catch (error) {
      DarkiworldApi.logger.warn(`Health check failed: ${error instanceof Error ? error.message : error}`);
      return false;
    }
  }

  async listLinks(titleId: number, options: ListLinksOptions = {}): Promise<boolean> {
    try {
      const response = await this.client.get(`/titles/${titleId}/content/liens`, {
        params: {
          limit: 1,
          streaming: 0,
          ...(options.host !== undefined && { host: options.host }),
          ...(options.lang !== undefined && { lang: options.lang }),
          ...(options.quality !== undefined && { qual: options.quality }),
          ...(options.season !== undefined && { saison: options.season }),
          ...(options.episode !== undefined && { episode: options.episode }),
        },
      });

      const count = response.data?.count ?? response.data?.data?.count ?? 0;
      return count > 0;
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 402) {
        DarkiworldApi.logger.debug(`Links available for title ${titleId} (got ${error.response.status})`);
        return true;
      }
      throw error;
    }
  }
}
