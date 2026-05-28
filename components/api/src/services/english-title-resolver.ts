import { Logger } from '@nestjs/common';

import { TmdbApiService } from '@/modules/tmdb/tmdb';

export type EnglishTitleResolution = {
  title: string | null;
  year: number | null;
};

export class EnglishTitleResolver {
  private static readonly logger = new Logger(EnglishTitleResolver.name);

  private readonly cache = new Map<string, EnglishTitleResolution>();

  constructor(private readonly tmdb: TmdbApiService) {}

  async resolve(imdbId: string): Promise<EnglishTitleResolution> {
    const cached = this.cache.get(imdbId);
    if (cached) {
      return cached;
    }

    let resolution: EnglishTitleResolution = { title: null, year: null };

    try {
      const { movies, tvShows } = await this.tmdb.findByImdbId(imdbId, { language: 'en-US' });
      const movie = movies[0];
      if (movie) {
        resolution = {
          title: movie.title || movie.original_title || null,
          year: movie.release_date ? Number(movie.release_date.slice(0, 4)) : null,
        };
      } else {
        const tv = tvShows[0];
        if (tv) {
          resolution = {
            title: tv.name || tv.original_name || null,
            year: tv.first_air_date ? Number(tv.first_air_date.slice(0, 4)) : null,
          };
        }
      }
    } catch (error) {
      EnglishTitleResolver.logger.warn(
        `TMDB lookup failed for ${imdbId}: ${error instanceof Error ? error.message : error}`,
      );
    }

    this.cache.set(imdbId, resolution);
    return resolution;
  }
}
