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
/** Unfiltered listings of a long-running show can run past one page; cap the walk. */
const MAX_LINK_PAGES = 5;

export const configSchema = z.object({
  apiHost: z.string().min(1),
  siteHost: z.string().min(1),
});

export type LoadixConfig = z.infer<typeof configSchema>;

export type ListLinksOptions = {
  seasonId?: string;
};

/** Inclusive release-year window, applied server-side by the search endpoint. */
export type YearRange = { from: number; to: number };

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

  async search(query: string, years: YearRange | null = null): Promise<LoadixSearchHit[]> {
    const response = await this.client.get('/media/search', {
      params: {
        q: query,
        page: 1,
        pageSize: SEARCH_PAGE_SIZE,
        sort: 'relevance',
        ...(years && { year_from: years.from, year_to: years.to }),
      },
    });
    return this.parse(loadixSearchResponseSchema, response.data, `search "${query}"`).hits;
  }

  async getMedia(id: string): Promise<LoadixMediaDetail> {
    const response = await this.client.get(`/media/${id}`);
    return this.parse(loadixMediaDetailSchema, response.data, `media ${id}`);
  }

  /** Every link of the media (or of one season), walking the pages up to a cap. */
  async listLinks(mediaId: string, options: ListLinksOptions = {}): Promise<LoadixLink[]> {
    const items: LoadixLink[] = [];
    let total = Infinity;
    for (let page = 1; items.length < total && page <= MAX_LINK_PAGES; page += 1) {
      const parsed = await this.listLinksPage(mediaId, page, options);
      items.push(...parsed.items);
      total = parsed.total;
      if (parsed.items.length === 0) {
        break;
      }
    }
    if (items.length < total) {
      LoadixApi.logger.warn(`Loadix returned ${items.length}/${total} links for ${mediaId}; extra pages ignored`);
    }
    return items;
  }

  private async listLinksPage(
    mediaId: string,
    page: number,
    options: ListLinksOptions,
  ): Promise<{ items: LoadixLink[]; total: number }> {
    const params = new URLSearchParams({
      page: String(page),
      perPage: String(LINKS_PER_PAGE),
      sort: 'scope_asc',
      linkType: 'ddl_url',
    });
    if (options.seasonId) {
      params.append('seasonId', options.seasonId);
    }
    const response = await this.client.get(`/media/${mediaId}/links`, { params });
    return this.parse(loadixLinksResponseSchema, response.data, `links of ${mediaId} p${page}`);
  }
}
