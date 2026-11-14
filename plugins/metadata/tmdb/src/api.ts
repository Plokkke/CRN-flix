import axios, { AxiosInstance } from 'axios';
import { z } from 'zod';

import { createLogger } from '@crn-flix/contracts';
import { applyAxiosRetry, logAxiosError, logAxiosRequest, logAxiosResponse } from '@crn-flix/http';

import {
  TmdbMovieDetails,
  tmdbMovieDetailsSchema,
  TmdbPeopleSearch,
  tmdbPeopleSearchSchema,
  TmdbTvDetails,
  tmdbTvDetailsSchema,
} from './facts';

/** Facts are read in English: genres and keywords are matched by name. */
const FACTS_LANGUAGE = 'en-US';

export const tmdbConfigSchema = z.object({
  apiKey: z.string(),
});

export type TmdbConfig = z.infer<typeof tmdbConfigSchema>;

export type TmdbMovie = {
  id: number;
  title: string;
  original_title: string;
  original_language?: string;
  poster_path?: string | null;
  release_date: string;
  popularity: number;
  vote_count: number;
};

export type TmdbTvShow = {
  id: number;
  name: string;
  original_name: string;
  original_language?: string;
  poster_path?: string | null;
  first_air_date: string;
  popularity: number;
  vote_count: number;
};

export type TmdbExternalIds = {
  imdb_id: string | null;
  tvdb_id: number | null;
};

export type TmdbPageKind = 'movie' | 'tv';

/** A movie or show page, with its external ids. */
export type TmdbPage<K extends TmdbPageKind> = (K extends 'movie' ? TmdbMovie : TmdbTvShow) & {
  external_ids: TmdbExternalIds;
};

export type TmdbEpisode = {
  id: number;
  name: string;
  episode_number: number;
  season_number: number;
  air_date: string;
};

export type TmdbIdentification = {
  tmdbId: number;
  imdbId: string | null;
  title: string;
  originalTitle: string | null;
  year: number | null;
  mediaType: 'movie' | 'episode';
};

export class TmdbApiService {
  private static readonly logger = createLogger(TmdbApiService.name);

  private readonly client: AxiosInstance;

  constructor(config: TmdbConfig) {
    this.client = axios.create({
      baseURL: 'https://api.themoviedb.org/3',
      headers: { Accept: 'application/json' },
      params: { api_key: config.apiKey, language: 'fr-FR' },
    });

    this.client.interceptors.request.use((request) => {
      logAxiosRequest(TmdbApiService.logger, request);
      return request;
    });

    this.client.interceptors.response.use(
      (response) => {
        logAxiosResponse(TmdbApiService.logger, response);
        return response;
      },
      (error) => {
        logAxiosError(TmdbApiService.logger, error);
        throw error;
      },
    );

    applyAxiosRetry(this.client, 'tmdb');
  }

  async searchMovie(title: string, year?: number): Promise<TmdbMovie[]> {
    const response = await this.client.get<{ results: TmdbMovie[] }>('/search/movie', {
      params: { query: title, ...(year && { year }) },
    });
    return response.data.results;
  }

  async searchTv(title: string, year?: number): Promise<TmdbTvShow[]> {
    const response = await this.client.get<{ results: TmdbTvShow[] }>('/search/tv', {
      params: { query: title, ...(year && { first_air_date_year: year }) },
    });
    return response.data.results;
  }

  async getMovieExternalIds(tmdbId: number): Promise<TmdbExternalIds> {
    const response = await this.client.get<TmdbExternalIds>(`/movie/${tmdbId}/external_ids`);
    return response.data;
  }

  async getTvExternalIds(tmdbId: number): Promise<TmdbExternalIds> {
    const response = await this.client.get<TmdbExternalIds>(`/tv/${tmdbId}/external_ids`);
    return response.data;
  }

  /** Null when TMDB has no such page. */
  async getPage<K extends TmdbPageKind>(kind: K, tmdbId: number, language: string): Promise<TmdbPage<K> | null> {
    try {
      const response = await this.client.get<TmdbPage<K>>(`/${kind}/${tmdbId}`, {
        params: { language, append_to_response: 'external_ids' },
      });
      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 404) {
        return null;
      }
      throw error;
    }
  }

  async findByImdbId(
    imdbId: string,
    opts: { language?: string } = {},
  ): Promise<{ movies: TmdbMovie[]; tvShows: TmdbTvShow[] }> {
    const response = await this.client.get(`/find/${imdbId}`, {
      params: { external_source: 'imdb_id', ...(opts.language && { language: opts.language }) },
    });
    return {
      movies: response.data.movie_results ?? [],
      tvShows: response.data.tv_results ?? [],
    };
  }

  async getTvEpisode(tvId: number, season: number, episode: number): Promise<TmdbEpisode | null> {
    try {
      const response = await this.client.get<TmdbEpisode>(`/tv/${tvId}/season/${season}/episode/${episode}`);
      return response.data;
    } catch {
      return null;
    }
  }

  /** Movie page with everything policies look at, in one call. */
  async getMovieDetails(tmdbId: number): Promise<TmdbMovieDetails> {
    const response = await this.client.get<unknown>(`/movie/${tmdbId}`, {
      params: { language: FACTS_LANGUAGE, append_to_response: 'credits,release_dates,keywords' },
    });
    return tmdbMovieDetailsSchema.parse(response.data);
  }

  /** Show page with credits aggregated over every episode, in one call. */
  async getTvDetails(tmdbId: number): Promise<TmdbTvDetails> {
    const response = await this.client.get<unknown>(`/tv/${tmdbId}`, {
      params: { language: FACTS_LANGUAGE, append_to_response: 'aggregate_credits,content_ratings,keywords' },
    });
    return tmdbTvDetailsSchema.parse(response.data);
  }

  async searchPeople(name: string): Promise<TmdbPeopleSearch> {
    const response = await this.client.get<unknown>('/search/person', {
      params: { query: name, language: FACTS_LANGUAGE },
    });
    return tmdbPeopleSearchSchema.parse(response.data);
  }
}
