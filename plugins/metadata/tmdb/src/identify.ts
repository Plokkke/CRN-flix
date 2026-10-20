import { createLogger, IdentificationQuery, IdentifiedMedia } from '@crn-flix/contracts';

import { TmdbApiService, TmdbMovie } from './api';

/** A release year this far from TMDB's still counts as the same title (festival vs release). */
const YEAR_TOLERANCE = 1;

const logger = createLogger('TmdbIdentification');

function yearOf(date: string | undefined): number | null {
  return date ? parseInt(date.substring(0, 4), 10) : null;
}

const isNearYear = (wanted: number | null, actual: number | null): boolean =>
  wanted === null || actual === null || Math.abs(wanted - actual) <= YEAR_TOLERANCE;

/** The best hit, unless its year is off and another hit matches the year. */
function pickMovie(results: TmdbMovie[], query: IdentificationQuery): TmdbMovie {
  const [best] = results;
  if (isNearYear(query.year, yearOf(best.release_date))) {
    return best;
  }
  logger.warn(`Year mismatch for "${query.title}": expected ${query.year}, got ${yearOf(best.release_date)}`);
  return results.find((r) => yearOf(r.release_date) !== null && isNearYear(query.year, yearOf(r.release_date))) ?? best;
}

export async function identifyMovie(tmdb: TmdbApiService, query: IdentificationQuery): Promise<IdentifiedMedia | null> {
  const results = await tmdb.searchMovie(query.title, query.year ?? undefined);
  if (results.length === 0) {
    logger.warn(`No TMDb movie results for: "${query.title}" (${query.year})`);
    return null;
  }
  const movie = pickMovie(results, query);
  const { imdb_id: imdbId } = await tmdb.getMovieExternalIds(movie.id);
  const year = yearOf(movie.release_date);
  logger.log(`Identified movie: "${movie.title}" (${year}) — TMDb: ${movie.id}, IMDb: ${imdbId}`);
  return imdbId ? { imdbId, kind: 'movie', title: movie.title, originalTitle: movie.original_title, year } : null;
}

export async function identifyShow(tmdb: TmdbApiService, query: IdentificationQuery): Promise<IdentifiedMedia | null> {
  const results = await tmdb.searchTv(query.title, query.year ?? undefined);
  if (results.length === 0) {
    logger.warn(`No TMDb TV results for: "${query.title}" (${query.year})`);
    return null;
  }
  const [show] = results;
  const { imdb_id: imdbId } = await tmdb.getTvExternalIds(show.id);
  const year = yearOf(show.first_air_date);
  logger.log(`Identified series: "${show.name}" (${year}) — TMDb: ${show.id}, IMDb: ${imdbId}`);
  return imdbId ? { imdbId, kind: 'show', title: show.name, originalTitle: show.original_name, year } : null;
}
