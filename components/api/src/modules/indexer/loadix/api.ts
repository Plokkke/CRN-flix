import { Logger } from '@nestjs/common';
import axios, { AxiosInstance } from 'axios';
import { z } from 'zod';

import { logAxiosError, logAxiosRequest, logAxiosResponse } from '@/helpers/axios-logger';
import { applyAxiosRetry } from '@/helpers/axios-retry';
import { RateLimiter } from '@/helpers/rate-limiter';

import {
  LoadixLink,
  loadixLinksResponseSchema,
  LoadixMediaDetail,
  loadixMediaDetailSchema,
  LoadixSearchHit,
  loadixSearchResponseSchema,
} from './schemas';

/** Loadix publishes no rate-limit policy; half a second between calls keeps us clearly polite. */
const MIN_REQUEST_INTERVAL_MS = 500;
const SEARCH_PAGE_SIZE = 30;
const LINKS_PER_PAGE = 100;

export const configSchema = z.object({
  apiHost: z.string().min(1),
  siteHost: z.string().min(1),
});

export type LoadixConfig = z.infer<typeof configSchema>;

export class LoadixUnparseableResponseError extends Error {
  constructor(context: string, preview: string) {
    super(`Unparseable Loadix response for ${context}: ${preview}`);
    this.name = 'LoadixUnparseableResponseError';
  }
}

export class LoadixApi {
  private static readonly logger = new Logger(LoadixApi.name);

  private readonly client: AxiosInstance;
  private readonly limiter = new RateLimiter(MIN_REQUEST_INTERVAL_MS);

  constructor(config: LoadixConfig, serviceName: string) {
    const parsedConfig = configSchema.parse(config);
    const apiHost = parsedConfig.apiHost.replace(/\/+$/, '');
    const siteHost = parsedConfig.siteHost.replace(/\/+$/, '');

    this.client = axios.create({
      baseURL: `${apiHost}/api`,
      headers: {
        Accept: 'application/json',
        Origin: siteHost,
        Referer: `${siteHost}/`,
        'User-Agent': serviceName,
      },
    });

    this.client.interceptors.request.use(async (request) => {
      await this.limiter.acquire();
      logAxiosRequest(LoadixApi.logger, request);
      return request;
    });

    this.client.interceptors.response.use(
      (response) => {
        logAxiosResponse(LoadixApi.logger, response);
        return response;
      },
      (error) => {
        logAxiosError(LoadixApi.logger, error);
        throw error;
      },
    );

    // Registered last so it wraps the logging interceptor: a 429 is retried after the
    // Retry-After the server asks for, not after our own guess.
    applyAxiosRetry(this.client, 'loadix');
  }

  private parse<T>(schema: z.ZodType<T>, data: unknown, context: string): T {
    const result = schema.safeParse(data);
    if (!result.success) {
      const preview = typeof data === 'string' ? data.slice(0, 200) : JSON.stringify(data).slice(0, 200);
      throw new LoadixUnparseableResponseError(context, preview);
    }
    return result.data;
  }

  async search(query: string): Promise<LoadixSearchHit[]> {
    const response = await this.client.get('/media/search', {
      params: { q: query, page: 1, pageSize: SEARCH_PAGE_SIZE, sort: 'relevance' },
    });
    return this.parse(loadixSearchResponseSchema, response.data, `search "${query}"`).hits;
  }

  async getMedia(id: string): Promise<LoadixMediaDetail> {
    const response = await this.client.get(`/media/${id}`);
    return this.parse(loadixMediaDetailSchema, response.data, `media ${id}`);
  }

  async listLinks(mediaId: string, options: { seasonId?: string } = {}): Promise<LoadixLink[]> {
    const response = await this.client.get(`/media/${mediaId}/links`, {
      params: {
        page: 1,
        perPage: LINKS_PER_PAGE,
        sort: 'scope_asc',
        ...(options.seasonId && { seasonId: options.seasonId }),
      },
    });

    const parsed = this.parse(loadixLinksResponseSchema, response.data, `links of ${mediaId}`);
    if (parsed.total > parsed.items.length) {
      LoadixApi.logger.warn(
        `Loadix returned ${parsed.items.length}/${parsed.total} links for ${mediaId}; extra pages ignored`,
      );
    }
    return parsed.items;
  }
}
