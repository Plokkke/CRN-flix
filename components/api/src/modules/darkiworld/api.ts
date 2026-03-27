import { Logger } from '@nestjs/common';
import axios, { AxiosInstance } from 'axios';
import { z } from 'zod';

import { darkiworldSearchResponseSchema } from './schemas';
import { DarkiworldTitle, ListLinksOptions } from './types';

export const configSchema = z.object({
  apiKey: z.string(),
  host: z.string().min(1),
});

export type DarkiworldConfig = z.infer<typeof configSchema>;

export class DarkiworldApi {
  private static readonly logger = new Logger(DarkiworldApi.name);

  private readonly client: AxiosInstance;

  constructor(config: DarkiworldConfig) {
    const parsedConfig = configSchema.parse(config);

    this.client = axios.create({
      baseURL: `${parsedConfig.host}/api/v1`,
    });

    this.client.interceptors.request.use((request) => {
      request.headers.Authorization = `Bearer ${parsedConfig.apiKey}`;
      return request;
    });
  }

  async search(query: string, limit: number = 20): Promise<DarkiworldTitle[]> {
    const encodedQuery = encodeURIComponent(query);
    const response = await this.client.get(`/search/${encodedQuery}`, {
      params: { limit },
    });

    const result = darkiworldSearchResponseSchema.safeParse(response.data);
    if (!result.success) {
      DarkiworldApi.logger.debug(`Unexpected search response for "${query}": ${typeof response.data}`);
      return [];
    }
    return result.data.results;
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
      if (axios.isAxiosError(error) && (error.response?.status === 402 || error.response?.status === 500)) {
        DarkiworldApi.logger.debug(`Links available for title ${titleId} (got ${error.response.status})`);
        return true;
      }
      throw error;
    }
  }
}
