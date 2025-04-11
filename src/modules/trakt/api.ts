import { Logger } from '@nestjs/common';
import axios, { AxiosError, AxiosInstance, AxiosResponse, InternalAxiosRequestConfig } from 'axios';
import { range } from 'lodash';
import * as _ from 'lodash';
import { DateTime } from 'luxon';
import { z } from 'zod';

import { MemoryCacheService } from '@/services/cache/memory-cache.service';
import { wait } from '@/utils';

import { MEDIA_TYPES } from './constants';
import {
  authDeviceCtxtSchema,
  deviceTokenSchema,
  hiddenShowSchema,
  lastActivitiesSchema,
  mediaDetailsSchema,
  mediaSchema,
  progressShowSchema,
  ratedMediaSchema,
  seasonDetailsSchema,
  showDetailsSchema,
  userSettingsSchema,
  watchedShowSchema,
} from './schemas';
import {
  AuthDeviceCtxt,
  ActivityType,
  AuthDevicePublicCtxt,
  HiddenShow,
  LastActivities,
  Media,
  MediaDetails,
  MediaType,
  ProgressShow,
  ProgressShowNoDetails,
  ReleasedMedia,
  SeasonDetails,
  ShowDetails,
  UserAuthCtxt,
  UserSettings,
  WatchedShow,
} from './types';

const ACTIVITY_PATHS_BY_TYPE: Record<ActivityType, string[]> = {
  ALL: ['all'],
  WATCHED: ['movies.watched_at', 'episodes.watched_at'],
  RATED: ['movies.rated_at', 'episodes.rated_at', 'shows.rated_at', 'seasons.rated_at'],
  HIDDEN: ['shows.hidden_at', 'seasons.hidden_at', 'movies.hidden_at', 'episodes.hidden_at'],
  DROPPED: ['shows.dropped_at'],
  LISTED: ['lists.liked_at'],
  WATCHLISTED: ['watchlist.updated_at'],
  FAVORITED: ['favorites.updated_at'],
};

export const configSchema = z.object({
  host: z.string(),
  clientId: z.string(),
  clientSecret: z.string(),
});

export type Config = z.infer<typeof configSchema>;

async function rateLimitHandler<T, D>(
  response: AxiosResponse<T, D>,
  config: InternalAxiosRequestConfig<D>,
): Promise<AxiosResponse<T, D>> {
  const retryAfter = response.headers['retry-after'];
  const rateLimitHeader = response.headers['x-ratelimit'];
  let waitTime = parseInt(retryAfter, 10);
  if (!waitTime && rateLimitHeader) {
    try {
      const rateLimit = JSON.parse(rateLimitHeader);
      const untilTime = DateTime.fromISO(rateLimit['until']) as DateTime<true>;
      waitTime = untilTime.diffNow().as('seconds');
    } catch {}
  }
  await wait(waitTime * 1000);
  return axios(config);
}

function getAuthorization(user: UserAuthCtxt): string {
  return `Bearer ${user.accessToken}`;
}

function lastActivityOf(activity: ActivityType, lastActivities: LastActivities): DateTime<true> | null {
  const paths = ACTIVITY_PATHS_BY_TYPE[activity];
  const dates = paths
    .map((path) => _.get(lastActivities, path))
    .filter((date): date is DateTime<true> => date !== null);

  if (dates.length === 0) {
    return null;
  }
  return dates.sort((a, b) => b.diff(a).as('seconds'))[0];
}

export class TraktApi {
  private readonly api: AxiosInstance;
  private static readonly logger = new Logger(TraktApi.name);

  constructor(
    private readonly config: Config,
    private readonly cache: MemoryCacheService,
  ) {
    configSchema.parse(config);
    this.api = axios.create({
      baseURL: `https://${config.host}`,
      headers: {
        'trakt-api-version': '2',
        'trakt-api-key': this.config.clientId,
      },
    });

    this.api.interceptors.request.use((config) => {
      TraktApi.logger.debug(`Requesting ${config.method} ${config.url}`);
      return config;
    });

    this.api.interceptors.response.use(
      (r) => r,
      async (error: AxiosError): Promise<unknown> => {
        if (error.response?.status === 429) {
          return await rateLimitHandler(error.response, error.config!);
        }
        throw error;
      },
    );
  }

  private async requestLastActivities(user: UserAuthCtxt): Promise<LastActivities> {
    return this.cache.withCache(
      `last-activities-${user.id}`,
      async () => {
        const { data } = await this.api.get<LastActivities>('/sync/last_activities', {
          headers: {
            Authorization: getAuthorization(user),
          },
        });

        return lastActivitiesSchema.parse(data);
      },
      60,
    );
  }

  private async cacheKeyFor(user: UserAuthCtxt, activity: ActivityType): Promise<string> {
    const lastActivities = await this.requestLastActivities(user);
    return `${activity}-${user.id}-${lastActivityOf(activity, lastActivities)}`;
  }

  private async withCache<T>(user: UserAuthCtxt, activity: ActivityType, fn: () => Promise<T>): Promise<T> {
    const cacheKey = await this.cacheKeyFor(user, activity);
    return this.cache.withCache(cacheKey, fn);
  }

  private async requestAuthDeviceCtxt(): Promise<AuthDeviceCtxt> {
    const response = await this.api.post<unknown>('/oauth/device/code', { client_id: this.config.clientId });
    return authDeviceCtxtSchema.parse(response.data);
  }

  private async requestDeviceToken(code: string, interval: number = 1): Promise<UserAuthCtxt> {
    let response: AxiosResponse<unknown>;
    do {
      await wait(interval * 1000);
      response = await this.api.post<unknown>(
        '/oauth/device/token',
        {
          client_id: this.config.clientId,
          client_secret: this.config.clientSecret,
          code,
        },
        { validateStatus: null },
      );
    } while (response.status === 400);

    if (response.status !== 200) {
      throw new Error('Failed to authorize device');
    }

    const tokens = deviceTokenSchema.parse(response.data);
    return {
      id: '',
      accessToken: tokens.access_token,
    };
  }

  private async requestUserSettings(user: UserAuthCtxt): Promise<UserSettings> {
    return this.cache.withCache(
      `user-settings-${user.id}`,
      async () => {
        const response = await this.api.get<unknown>('/users/settings', {
          headers: { Authorization: getAuthorization(user) },
        });
        return userSettingsSchema.parse(response.data);
      },
      60 * 60 * 24,
    );
  }

  async requestShowDetails(showId: number): Promise<ShowDetails> {
    return this.cache.withCache(
      `show-details-${showId}`,
      async () => {
        const response = await this.api.get<unknown>(`/shows/${showId}`, {
          params: { extended: 'full' },
        });
        return showDetailsSchema.parse(response.data);
      },
      60 * 60 * 24,
    );
  }

  async requestShowSeasonsDetails(showId: number): Promise<SeasonDetails[]> {
    return this.cache.withCache(
      `show-seasons-details-${showId}`,
      async () => {
        const response = await this.api.get<unknown>(`/shows/${showId}/seasons`, {
          params: { extended: 'episodes' },
        });
        return seasonDetailsSchema.array().parse(response.data);
      },
      60 * 60 * 24,
    );
  }

  async authorizeDevice(codeHandler: (ctxt: AuthDevicePublicCtxt) => Promise<void> | void): Promise<UserAuthCtxt> {
    const authDeviceCtxt = await this.requestAuthDeviceCtxt();

    await codeHandler({
      verification_url: authDeviceCtxt.verification_url,
      user_code: authDeviceCtxt.user_code,
      expires_in: authDeviceCtxt.expires_in,
    });

    const authCtxt = await this.requestDeviceToken(authDeviceCtxt.device_code, authDeviceCtxt.interval);

    const userSettings = await this.requestUserSettings(authCtxt);

    authCtxt.id = userSettings.user.ids.slug;
    return authCtxt;
  }

  async requestUserWatchlist(user: UserAuthCtxt, released: true): Promise<ReleasedMedia[]>;
  async requestUserWatchlist(user: UserAuthCtxt, released: false): Promise<Media[]>;
  async requestUserWatchlist(user: UserAuthCtxt, released: boolean = false): Promise<ReleasedMedia[] | Media[]> {
    return this.withCache(user, 'WATCHLISTED', async () => {
      const response = await this.api.get<unknown>(`/sync/watchlist`, {
        headers: { Authorization: `Bearer ${user.accessToken}` },
        params: released ? { extended: 'full' } : {},
      });
      if (released) {
        const medias = mediaDetailsSchema.array().parse(response.data);
        return medias.filter((media: MediaDetails) => {
          if (media.type === 'movie') {
            return media.movie.released !== null && media.movie.released <= DateTime.now();
          } else {
            return !!media.show.first_aired && media.show.first_aired <= DateTime.now();
          }
        });
      } else {
        return z.array(mediaSchema).parse(response.data);
      }
    });
  }

  async requestUserList(user: UserAuthCtxt, listName: string): Promise<Media[]> {
    return this.withCache(user, 'LISTED', async () => {
      const listsResponse = await this.api.get<{ name: string; ids: { slug: string } }[]>('/users/me/lists', {
        headers: { Authorization: getAuthorization(user) },
      });
      const list = listsResponse.data.find((list) => list.name === listName);
      if (!list) {
        return [];
      }

      const listItemsResponse = await this.api.get<unknown>(`/users/me/lists/${list.ids.slug}/items`, {
        headers: { Authorization: getAuthorization(user) },
      });
      return mediaSchema.array().parse(listItemsResponse.data);
    });
  }

  async requestUserHidden(
    user: UserAuthCtxt,
    section: 'progress_watched' = 'progress_watched',
    type: MediaType = 'show',
  ): Promise<HiddenShow[]> {
    return this.withCache(user, 'HIDDEN', async () => {
      const response = await this.api.get<unknown>(`/users/hidden/${section}`, {
        headers: { Authorization: getAuthorization(user) },
        params: { type, limit: 9999 },
      });
      return hiddenShowSchema.array().parse(response.data);
    });
  }

  async requestUserWatched(user: UserAuthCtxt, type: MediaType = 'show'): Promise<WatchedShow[]> {
    return this.withCache(user, 'WATCHED', async () => {
      const response = await this.api.get<unknown>(`/sync/watched/${type}s`, {
        headers: { Authorization: `Bearer ${user.accessToken}` },
        params: { extended: 'noseasons' },
      });
      return watchedShowSchema.array().parse(response.data);
    });
  }

  async requestShowProgress(user: UserAuthCtxt, showId: number): Promise<ProgressShowNoDetails> {
    return this.withCache(user, 'WATCHED', async () => {
      const response = await this.api.get<unknown>(`/shows/${showId}/progress/watched`, {
        headers: { Authorization: getAuthorization(user) },
      });
      return progressShowSchema.parse(response.data);
    });
  }

  async getWatchingShows(user: UserAuthCtxt): Promise<ProgressShow[]> {
    const hiddenShows = await this.requestUserHidden(user);
    const hiddenShowsIds = hiddenShows.map((hidden) => hidden.show.ids.trakt);

    let watchedShows = await this.requestUserWatched(user);
    watchedShows = watchedShows.filter((show) => !hiddenShowsIds.includes(show.show.ids.trakt));

    const progress = await watchedShows.reduce(
      async (acc, show) => {
        const prog = {
          show: show.show,
          ...(await this.requestShowProgress(user, show.show.ids.trakt)),
        };
        return [...(await acc), prog];
      },
      Promise.resolve([] as ProgressShow[]),
    );

    return progress.filter((show: ProgressShow) => show.next_episode !== null && show.aired > show.completed);
  }

  async requestUserRated(user: UserAuthCtxt, type: MediaType, rates: number[]): Promise<Media[]> {
    return this.withCache(user, 'RATED', async () => {
      const response = await this.api.get<unknown>(`/sync/ratings/${type}s/${rates.join(',')}`, {
        headers: { Authorization: getAuthorization(user) },
      });
      return ratedMediaSchema.array().parse(response.data);
    });
  }

  async getHighRatedMedias(user: UserAuthCtxt, ratingThreshold: number): Promise<Media[]> {
    if (ratingThreshold < 1 || ratingThreshold > 10) {
      throw new Error('Invalid rating threshold, must be between 1 and 10');
    }
    const rates = range(ratingThreshold, 10 + 1);

    return (
      await Promise.all(MEDIA_TYPES.map((type): Promise<Media[]> => this.requestUserRated(user, type, rates)))
    ).flat();
  }
}
