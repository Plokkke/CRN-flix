import { Logger } from '@nestjs/common';
import axios, { AxiosInstance } from 'axios';
import { z } from 'zod';

import { logAxiosError, logAxiosRequest, logAxiosResponse } from '@/helpers/axios-logger';

export const tmdbConfigSchema = z.object({
  apiKey: z.string(),
});

export type TmdbConfig = z.infer<typeof tmdbConfigSchema>;

export type TmdbMovie = {
  id: number;
  title: string;
  original_title: string;
  release_date: string;
  popularity: number;
  vote_count: number;
};

export type TmdbTvShow = {
  id: number;
  name: string;
  original_name: string;
  first_air_date: string;
  popularity: number;
  vote_count: number;
};

export type TmdbExternalIds = {
  imdb_id: string | null;
  tvdb_id: number | null;
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
  private static readonly logger = new Logger(TmdbApiService.name);

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

  async findByImdbId(imdbId: string): Promise<{ movies: TmdbMovie[]; tvShows: TmdbTvShow[] }> {
    const response = await this.client.get(`/find/${imdbId}`, {
      params: { external_source: 'imdb_database' },
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
}
