import * as _ from 'lodash';
import { DateTime } from 'luxon';
import { z } from 'zod';

import {
  Catalog,
  CatalogAccount,
  CatalogAccountRevokedError,
  CatalogActivity,
  CatalogItem,
  createLogger,
  MediaType,
  Playhead,
  RequestReason,
  START_OF_SHOW,
} from '@crn-flix/contracts';

import { TraktApi, TraktDeviceAuthResult } from './api';
import { Episode, Media, Movie, MovieDetails, ProgressShow, Show, UserAuthCtxt } from './types';

export type TraktCatalogConfig = {
  /** Minimum rating (1–10) for a rated title to count as a request. */
  ratingThreshold: number;
};

const credentialsSchema = z.object({
  accessToken: z.string().optional(),
  refreshToken: z.string().optional(),
  accessTokenExpiration: z.string().optional(),
});

/** Renewed a day ahead, so a sync never runs on an expired token. */
const RENEW_BEFORE_MS = 24 * 60 * 60 * 1000;

const ACTIVITIES_BY_REASON: Record<RequestReason, string[]> = {
  [RequestReason.Watchlisted]: ['watchlist.updated_at'],
  [RequestReason.HighRated]: ['movies.rated_at', 'episodes.rated_at', 'shows.rated_at', 'seasons.rated_at'],
  [RequestReason.Progress]: ['shows.hidden_at', 'shows.dropped_at', 'movies.watched_at', 'episodes.watched_at'],
};

/** Completed or dropped: the show only ever contributes deferred urgency. */
const COMPLETED: Playhead = { nextSeason: null, nextEpisode: null };

const NO_TITLES = { originalTitle: null, frenchTitle: null, originalLanguage: null };

function episodeItem(episode: Pick<Episode, 'season' | 'number'>, show: Show, runtime: number | null): CatalogItem {
  return {
    type: MediaType.Episode,
    imdbId: show.ids.imdb ?? '',
    title: show.title,
    ...NO_TITLES,
    year: show.year,
    seasonNumber: episode.season,
    episodeNumber: episode.number,
    runtimeMinutes: runtime,
    catalogSlug: show.ids.slug ?? null,
  };
}

function filterAiredEpisodes(episodes: Episode[], airedEpisodes: number | null, startIndex: number): Episode[] {
  if (airedEpisodes === null) {
    return [];
  }
  return episodes.slice(0, Math.max(0, airedEpisodes - startIndex));
}

function latestOf(dates: Array<DateTime | null | undefined>): Date | null {
  const known = dates.filter((date): date is DateTime => !!date);
  return known.length ? DateTime.max(...known)!.toJSDate() : null;
}

export class TraktCatalog implements Catalog {
  private static readonly logger = createLogger(TraktCatalog.name);

  readonly name = 'trakt';
  readonly reasons = Object.values(RequestReason);

  private readonly fetchByReason: Record<RequestReason, (auth: UserAuthCtxt) => Promise<CatalogItem[]>> = {
    [RequestReason.Watchlisted]: async (auth) => this.expand(await this.api.requestUserWatchlist(auth, true)),
    [RequestReason.HighRated]: async (auth) =>
      this.expand(await this.api.getHighRatedMedias(auth, this.config.ratingThreshold)),
    [RequestReason.Progress]: async (auth) => this.expandProgressShows(await this.api.getWatchingShows(auth)),
  };

  constructor(
    private readonly api: TraktApi,
    private readonly config: TraktCatalogConfig,
  ) {}

  /** A new episode of a followed show is a progress activity too, though the user did nothing. */
  async lastActivity(account: CatalogAccount): Promise<CatalogActivity> {
    const auth = this.authOf(account);
    const [activities, latestAiring] = await Promise.all([
      this.api.getLastActivities(auth),
      this.api.getLatestFollowedAiring(auth),
    ]);
    const activity = _.mapValues(ACTIVITIES_BY_REASON, (paths) =>
      latestOf(paths.map((path) => _.get(activities, path) as DateTime | null | undefined)),
    );
    const progress = activity[RequestReason.Progress];
    return {
      ...activity,
      [RequestReason.Progress]: latestOf([progress ? DateTime.fromJSDate(progress) : null, latestAiring]),
    };
  }

  async listRequests(account: CatalogAccount, reason: RequestReason): Promise<CatalogItem[]> {
    return this.fetchByReason[reason](this.authOf(account));
  }

  async playhead(account: CatalogAccount, showImdbId: string): Promise<Playhead> {
    const auth = this.authOf(account);
    const entry = (await this.api.requestUserWatched(auth)).find((w) => w.show.ids.imdb === showImdbId);
    if (!entry) {
      return START_OF_SHOW;
    }
    if ((await this.api.listExcludedShowIds(auth)).has(entry.show.ids.trakt)) {
      return COMPLETED;
    }
    const progress = await this.api.requestShowProgress(auth, entry.show.ids.trakt);
    if (!progress.next_episode || progress.aired <= progress.completed) {
      return COMPLETED;
    }
    return { nextSeason: progress.next_episode.season, nextEpisode: progress.next_episode.number };
  }

  async renewCredentials(credentials: unknown, now: Date): Promise<TraktDeviceAuthResult | null> {
    const { accessToken, refreshToken, accessTokenExpiration } = credentialsSchema.parse(credentials);
    const remainingMs = accessTokenExpiration ? Date.parse(accessTokenExpiration) - now.getTime() : Infinity;
    if (accessToken && remainingMs > RENEW_BEFORE_MS) {
      return null;
    }
    if (!refreshToken) {
      throw new CatalogAccountRevokedError('no refresh token');
    }
    const renewed = await this.api.refreshTokens(refreshToken);
    if (!renewed) {
      throw new CatalogAccountRevokedError('Trakt refused the refresh token');
    }
    return renewed;
  }

  private authOf(account: CatalogAccount): UserAuthCtxt {
    const { accessToken } = credentialsSchema.parse(account.credentials);
    if (!accessToken) {
      throw new CatalogAccountRevokedError('no access token');
    }
    return { id: account.userRef, accessToken };
  }

  /** Full show expansion: watched episodes are simply already fulfilled or not wanted. */
  private async expandProgressShows(progressShows: ProgressShow[]): Promise<CatalogItem[]> {
    const episodes = await Promise.all(
      progressShows.map(async ({ show }) => {
        const expanded = await this.expandShow(show);
        TraktCatalog.logger.log(`[progress.expand] "${show.title}" → ${expanded.length} episode(s)`);
        return expanded;
      }),
    );
    return episodes.flat();
  }

  private async expand(medias: Media[]): Promise<CatalogItem[]> {
    const movies = await Promise.all(
      medias.filter((media) => media.type === 'movie').map((m) => this.movieItem(m.movie)),
    );
    const episodes = medias
      .filter((media) => media.type === 'episode')
      .map((m) => episodeItem(m.episode, m.show, null));
    const expanded = await Promise.all([
      ...medias.filter((media) => media.type === 'show').map((s) => this.expandShow(s.show)),
      ...medias.filter((media) => media.type === 'season').map((s) => this.expandSeason(s.show, s.season.number)),
    ]);
    return [...movies, ...episodes, ...expanded.flat()];
  }

  private async movieItem(movie: Movie | MovieDetails): Promise<CatalogItem> {
    return {
      type: MediaType.Movie,
      imdbId: movie.ids.imdb ?? '',
      title: movie.title,
      ...NO_TITLES,
      year: movie.year,
      seasonNumber: null,
      episodeNumber: null,
      runtimeMinutes: await this.movieRuntime(movie),
      catalogSlug: movie.ids.slug ?? null,
    };
  }

  /**
   * The size cap silently passes without a runtime: never return a movie without one.
   * Watchlist items fetched with `extended=full` already carry it; other sources cost one cached call.
   */
  private async movieRuntime(movie: Movie | MovieDetails): Promise<number | null> {
    if ('runtime' in movie && movie.runtime !== null) {
      return movie.runtime;
    }
    try {
      return (await this.api.requestMovieDetails(movie.ids.trakt)).runtime;
    } catch (error) {
      TraktCatalog.logger.warn(
        `Runtime unavailable for movie "${movie.title}": ${error instanceof Error ? error.message : error}`,
      );
      return null;
    }
  }

  private async expandShow(show: Show): Promise<CatalogItem[]> {
    const showDetails = await this.api.requestShowDetails(show.ids.trakt);
    const seasons = await this.api.requestShowSeasonsDetails(show.ids.trakt);
    const episodes = seasons.flatMap((season) => (season.number > 0 ? season.episodes : []));

    return filterAiredEpisodes(episodes, showDetails.aired_episodes, 0).map((episode) =>
      episodeItem(episode, show, showDetails.runtime),
    );
  }

  private async expandSeason(show: Show, seasonNumber: number): Promise<CatalogItem[]> {
    const showDetails = await this.api.requestShowDetails(show.ids.trakt);
    const seasons = await this.api.requestShowSeasonsDetails(show.ids.trakt);
    const season = seasons.find((s) => s.number === seasonNumber);
    if (!season) {
      return [];
    }
    const startIndex = seasons
      .filter((s) => s.number > 0 && s.number < seasonNumber)
      .reduce((acc, s) => acc + s.episodes.length, 0);

    return filterAiredEpisodes(season.episodes, showDetails.aired_episodes, startIndex).map((episode) =>
      episodeItem(episode, show, showDetails.runtime),
    );
  }
}
