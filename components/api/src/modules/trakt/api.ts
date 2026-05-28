import { Logger } from '@nestjs/common';
import axios, { AxiosError, AxiosInstance, AxiosResponse, InternalAxiosRequestConfig } from 'axios';
import { range } from 'lodash';
import * as _ from 'lodash';
import { DateTime } from 'luxon';
import { z } from 'zod';

import { logAxiosError, logAxiosRequest, logAxiosResponse } from '@/helpers/axios-logger';
import { MemoryCacheService } from '@/services/cache/memory-cache.service';
import { wait } from '@/utils';

import { ActivityType, TraktMediaType } from './constants';
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
  [ActivityType.All]: ['all'],
  [ActivityType.Watched]: ['movies.watched_at', 'episodes.watched_at'],
  [ActivityType.Rated]: ['movies.rated_at', 'episodes.rated_at', 'shows.rated_at', 'seasons.rated_at'],
  [ActivityType.Hidden]: ['shows.hidden_at', 'seasons.hidden_at', 'movies.hidden_at', 'episodes.hidden_at'],
  [ActivityType.Dropped]: ['shows.dropped_at'],
  [ActivityType.Listed]: ['lists.liked_at'],
  [ActivityType.Watchlisted]: ['watchlist.updated_at'],
  [ActivityType.Favorited]: ['favorites.updated_at'],
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

export type TraktDeviceAuthResult = {
  accessToken: string;
  refreshToken: string;
  /** ISO 8601 absolute expiration, suitable for Jellyfin Trakt plugin config. */
  accessTokenExpiration: string;
};

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

    this.api.interceptors.request.use((request) => {
      logAxiosRequest(TraktApi.logger, request);
      return request;
    });

    this.api.interceptors.response.use(
      (response) => {
        logAxiosResponse(TraktApi.logger, response);
        return response;
      },
      async (error: AxiosError): Promise<unknown> => {
        if (error.response?.status === 429) {
          TraktApi.logger.warn(`Rate limited by Trakt, retrying after backoff`);
          return await rateLimitHandler(error.response, error.config!);
        }
        logAxiosError(TraktApi.logger, error);
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

  private async requestDeviceToken(
    code: string,
    interval: number = 1,
    expiresInSeconds: number = 600,
  ): Promise<TraktDeviceAuthResult> {
    // Trakt OAuth device flow polling states (per https://trakt.docs.apiary.io):
    //   400 Pending — user hasn't approved yet; keep polling
    //   404 Not Found — invalid device_code
    //   409 Conflict — already approved for a different app
    //   410 Gone — device_code expired (expires_in elapsed)
    //   418 Teapot — user denied
    //   429 Slow Down — we polled too fast, back off
    let intervalMs = interval * 1000;
    const deadline = Date.now() + expiresInSeconds * 1000;
    let response: AxiosResponse<unknown>;

    while (true) {
      if (Date.now() >= deadline) {
        throw new Error('Trakt device authorization timed out (expires_in elapsed)');
      }
      await wait(intervalMs);
      response = await this.api.post<unknown>(
        '/oauth/device/token',
        {
          client_id: this.config.clientId,
          client_secret: this.config.clientSecret,
          code,
        },
        { validateStatus: null },
      );

      if (response.status === 200) {
        break;
      }
      if (response.status === 400) {
        continue;
      }
      if (response.status === 429) {
        TraktApi.logger.warn('Trakt device token poll rate-limited, doubling interval');
        intervalMs = Math.min(intervalMs * 2, 60_000);
        continue;
      }
      if (response.status === 404) {
        throw new Error('Trakt device authorization failed: invalid device_code');
      }
      if (response.status === 409) {
        throw new Error('Trakt device authorization failed: already used');
      }
      if (response.status === 410) {
        throw new Error('Trakt device authorization expired before user approved');
      }
      if (response.status === 418) {
        throw new Error('Trakt device authorization denied by user');
      }
      throw new Error(`Trakt device authorization failed with status ${response.status}`);
    }

    const tokens = deviceTokenSchema.parse(response.data);
    // Trakt returns `created_at` (unix s) and `expires_in` (s); compose absolute expiration.
    const expirationMs = (tokens.created_at + tokens.expires_in) * 1000;
    return {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      accessTokenExpiration: new Date(expirationMs).toISOString(),
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

  async authorizeDevice(
    codeHandler: (ctxt: AuthDevicePublicCtxt) => Promise<void> | void,
  ): Promise<TraktDeviceAuthResult & { id: string }> {
    const authDeviceCtxt = await this.requestAuthDeviceCtxt();

    await codeHandler({
      verification_url: authDeviceCtxt.verification_url,
      user_code: authDeviceCtxt.user_code,
      expires_in: authDeviceCtxt.expires_in,
    });

    const tokenResult = await this.requestDeviceToken(
      authDeviceCtxt.device_code,
      authDeviceCtxt.interval,
      authDeviceCtxt.expires_in,
    );

    const userSettings = await this.requestUserSettings({ id: '', accessToken: tokenResult.accessToken });

    return { ...tokenResult, id: userSettings.user.ids.slug };
  }

  async requestUserWatchlist(user: UserAuthCtxt, released: true): Promise<ReleasedMedia[]>;
  async requestUserWatchlist(user: UserAuthCtxt, released: false): Promise<Media[]>;
  async requestUserWatchlist(user: UserAuthCtxt, released: boolean = false): Promise<ReleasedMedia[] | Media[]> {
    return this.withCache(user, ActivityType.Watchlisted, async () => {
      const response = await this.api.get<unknown>(`/sync/watchlist`, {
        headers: { Authorization: `Bearer ${user.accessToken}` },
        params: released ? { extended: 'full' } : {},
      });
      if (released) {
        const medias = mediaDetailsSchema.array().parse(response.data);
        return medias.filter((media: MediaDetails) => {
          if (media.type === TraktMediaType.Movie) {
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
    return this.withCache(user, ActivityType.Listed, async () => {
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
    type: MediaType = TraktMediaType.Show,
  ): Promise<HiddenShow[]> {
    return this.withCache(user, ActivityType.Hidden, async () => {
      const response = await this.api.get<unknown>(`/users/hidden/${section}`, {
        headers: { Authorization: getAuthorization(user) },
        params: { type, limit: 9999 },
      });
      return hiddenShowSchema.array().parse(response.data);
    });
  }

  async requestUserWatched(user: UserAuthCtxt, type: MediaType = TraktMediaType.Show): Promise<WatchedShow[]> {
    return this.withCache(user, ActivityType.Watched, async () => {
      const response = await this.api.get<unknown>(`/sync/watched/${type}s`, {
        headers: { Authorization: `Bearer ${user.accessToken}` },
        params: { extended: 'noseasons' },
      });
      return watchedShowSchema.array().parse(response.data);
    });
  }

  async requestShowProgress(user: UserAuthCtxt, showId: number): Promise<ProgressShowNoDetails> {
    const lastActivities = await this.requestLastActivities(user);
    const watchedTs = lastActivityOf(ActivityType.Watched, lastActivities);
    const cacheKey = `show-progress-${user.id}-${showId}-${watchedTs}`;
    return this.cache.withCache(cacheKey, async () => {
      const response = await this.api.get<unknown>(`/shows/${showId}/progress/watched`, {
        headers: { Authorization: getAuthorization(user) },
      });
      return progressShowSchema.parse(response.data);
    });
  }

  async getWatchingShows(user: UserAuthCtxt): Promise<ProgressShow[]> {
    const hiddenShows = await this.requestUserHidden(user);
    const hiddenShowsIds = hiddenShows.map((hidden) => hidden.show.ids.trakt);
    TraktApi.logger.log(`[progress] user ${user.id}: ${hiddenShows.length} hidden shows`);

    const allWatchedShows = await this.requestUserWatched(user);
    const watchedShows = allWatchedShows.filter((show) => !hiddenShowsIds.includes(show.show.ids.trakt));
    TraktApi.logger.log(
      `[progress] user ${user.id}: ${allWatchedShows.length} watched shows (${watchedShows.length} after hidden filter)`,
    );

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

    const eligible = progress.filter((show: ProgressShow) => show.next_episode !== null && show.aired > show.completed);
    TraktApi.logger.log(
      `[progress] user ${user.id}: ${progress.length} progress entries, ${eligible.length} with next episode pending (aired>completed)`,
    );
    for (const p of progress) {
      TraktApi.logger.debug(
        `[progress] "${p.show.title}" (${p.show.ids.trakt}): aired=${p.aired}, completed=${p.completed}, next=${p.next_episode ? `S${p.next_episode.season}E${p.next_episode.number}` : 'none'}`,
      );
    }
    return eligible;
  }

  async requestUserRated(user: UserAuthCtxt, type: MediaType, rates: number[]): Promise<Media[]> {
    return this.withCache(user, ActivityType.Rated, async () => {
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
      await Promise.all(
        Object.values(TraktMediaType).map((type): Promise<Media[]> => this.requestUserRated(user, type, rates)),
      )
    ).flat();
  }

  async getLastActivities(user: UserAuthCtxt): Promise<LastActivities> {
    return this.requestLastActivities(user);
  }
}
