import { Logger } from '@nestjs/common';
import axios, { AxiosInstance } from 'axios';
import { z } from 'zod';

import { logAxiosError, logAxiosRequest, logAxiosResponse } from '@/helpers/axios-logger';
import { applyAxiosRetry } from '@/helpers/axios-retry';
import { RateLimiter } from '@/helpers/rate-limiter';

import { hydrackerSearchResponseSchema, HydrackerTitle } from './schemas';

/** Hydracker caps at 1 request per second per bearer token, with no burst allowance. */
const MIN_REQUEST_INTERVAL_MS = 1_000;

export const configSchema = z.object({
  apiKey: z.string(),
  host: z.string().min(1),
  /** Optional contact appended to the User-Agent so Hydracker can reach us about our usage. */
  contactEmail: z.string().min(1).optional(),
});

export type HydrackerConfig = z.infer<typeof configSchema>;

export type ListLinksOptions = {
  season?: number;
  episode?: number;
  quality?: number;
  lang?: number;
  host?: number;
};

export class HydrackerUnparseableResponseError extends Error {
  constructor(query: string, preview: string) {
    super(`Unparseable Hydracker response for "${query}": ${preview}`);
    this.name = 'HydrackerUnparseableResponseError';
  }
}

export class HydrackerApi {
  private static readonly logger = new Logger(HydrackerApi.name);

  /**
   * Hydracker's WAF answers generic clients (axios/*, curl/*, …) with a login page instead of
   * JSON, so identifying ourselves is mandatory rather than merely polite.
   */
  static buildUserAgent(serviceName: string, contactEmail?: string): string {
    return contactEmail ? `${serviceName} (${contactEmail})` : serviceName;
  }

  private readonly client: AxiosInstance;
  private readonly limiter = new RateLimiter(MIN_REQUEST_INTERVAL_MS);

  constructor(config: HydrackerConfig, serviceName: string) {
    const parsedConfig = configSchema.parse(config);

    const baseHost = parsedConfig.host.replace(/\/+$/, '');
    this.client = axios.create({
      baseURL: `${baseHost}/api/v1`,
      headers: {
        Accept: 'application/json',
        'User-Agent': HydrackerApi.buildUserAgent(serviceName, parsedConfig.contactEmail),
      },
    });

    this.client.interceptors.request.use(async (request) => {
      await this.limiter.acquire();
      request.headers.Authorization = `Bearer ${parsedConfig.apiKey}`;
      logAxiosRequest(HydrackerApi.logger, request);
      return request;
    });

    this.client.interceptors.response.use(
      (response) => {
        logAxiosResponse(HydrackerApi.logger, response);
        return response;
      },
      (error) => {
        logAxiosError(HydrackerApi.logger, error);
        throw error;
      },
    );

    // Registered last so it wraps the logging interceptor: a 429 is retried after the
    // Retry-After the server asks for, not after our own guess.
    applyAxiosRetry(this.client, 'hydracker');
  }

  async search(query: string, limit: number = 20): Promise<HydrackerTitle[]> {
    const encodedQuery = encodeURIComponent(query);
    const response = await this.client.get(`/search/${encodedQuery}`, {
      params: { limit },
    });

    const result = hydrackerSearchResponseSchema.safeParse(response.data);
    if (!result.success) {
      const preview = typeof response.data === 'string' ? response.data.slice(0, 200) : JSON.stringify(response.data);
      throw new HydrackerUnparseableResponseError(query, preview);
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
      if (axios.isAxiosError(error) && error.response?.status === 402) {
        HydrackerApi.logger.debug(`Links available for title ${titleId} (got ${error.response.status})`);
        return true;
      }
      throw error;
    }
  }
}
