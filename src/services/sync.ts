import { Logger } from '@nestjs/common';
import * as _ from 'lodash';
import { DateTime } from 'luxon';
import { z } from 'zod';

import { JellyfinMedia, JellyfinMediaService } from '@/modules/jellyfin/jellyfin';
import { TraktPlugin } from '@/modules/jellyfin/plugins/trakt';
import { TraktApi } from '@/modules/trakt/api';
import { Episode, Media, ProgressShow, Show, UserAuthCtxt } from '@/modules/trakt/types';
import { MediaInfos, MediasRepository } from '@/services/database/medias';
import { RequestsRepository } from '@/services/database/requests';
import { UserActivitiesRepository } from '@/services/database/user-activities';
import { UserEntity, UsersRepository } from '@/services/database/users';

export const syncConfigSchema = z.object({
  ratingThreshold: z.number().int().optional().default(10),
  ratedLimit: z.number().int().optional().default(80),
  wantedLimit: z.number().int().optional().default(30),
  progressLimit: z.number().int().optional().default(10),
  bufferDuration: z.number().int().optional().default(150),
});

export type SyncConfig = z.infer<typeof syncConfigSchema>;

export const REQUEST_KINDS = ['WATCHLISTED', 'LISTED', 'PROGRESS', 'HIGH_RATED'] as const;
export type RequestKind = (typeof REQUEST_KINDS)[number];

export const ACTIVITIES_INVOLVED_BY_REQUEST_KIND: Record<RequestKind, string[]> = {
  WATCHLISTED: ['watchlist.updated_at'],
  LISTED: ['lists.liked_at'],
  HIGH_RATED: ['movies.rated_at', 'episodes.rated_at', 'shows.rated_at', 'seasons.rated_at'],
  PROGRESS: ['shows.hidden_at', 'shows.dropped_at', 'movies.watched_at', 'episodes.watched_at'],
};

function mapEpisodeToRequest(episode: Episode, show: Show): MediaInfos {
  return {
    type: 'episode',
    title: show.title,
    year: show.year,
    imdbId: episode.ids.imdb ?? '',
    seasonNumber: episode.season,
    episodeNumber: episode.number,
  };
}

function filterAiredEpisodes(episodes: Episode[], airedEpisodes: number | null, startIndex: number): Episode[] {
  if (airedEpisodes === null) {
    return [];
  }
  const availableEpisodes = Math.max(0, airedEpisodes - startIndex);
  return episodes.slice(0, availableEpisodes);
}

type UserWithAuthContext = UserEntity & {
  accessToken: string;
};

export class SyncService {
  private static readonly logger = new Logger(SyncService.name);

  private readonly requestHandlerByKind: Record<RequestKind, (user: UserAuthCtxt) => Promise<MediaInfos[]>> = {
    WATCHLISTED: async (user) => {
      const watchlistedMedias = await this.traktClient.requestUserWatchlist(user, true);
      return this.expand(watchlistedMedias, true);
    },
    LISTED: async (user) => {
      const listedMedias = await this.traktClient.requestUserList(user, 'Jellyfin');
      return this.expand(listedMedias, false);
    },
    HIGH_RATED: async (user) => {
      const highRatedMedias = await this.traktClient.getHighRatedMedias(user, this.config.ratingThreshold);
      return this.expand(highRatedMedias, false);
    },
    PROGRESS: async (user) => {
      const progressShows = await this.traktClient.getWatchingShows(user);
      return this.expandProgressShows(progressShows);
    },
  };

  constructor(
    private readonly config: SyncConfig,
    private readonly jellyfin: JellyfinMediaService,
    private readonly traktPlugin: TraktPlugin,
    private readonly traktClient: TraktApi,
    private readonly usersRepository: UsersRepository,
    private readonly userActivitiesRepository: UserActivitiesRepository,
    private readonly mediasRepository: MediasRepository,
    private readonly requestsRepository: RequestsRepository,
  ) {}

  private async listUsers(): Promise<UserWithAuthContext[]> {
    const users = await this.usersRepository.list();
    const authContexts = await this.traktPlugin.getUsersAuthContext();

    return authContexts
      .map(
        (authContext): UserWithAuthContext => ({
          ...authContext,
          ...users.find((user) => user.jellyfinId === authContext.jellyfinId)!,
        }),
      )
      .filter((user) => user.id);
  }

  private async getLastUpdatedAtByKind(user: UserAuthCtxt): Promise<Record<RequestKind, DateTime<true> | null>> {
    const lastActivities = await this.traktClient.getLastActivities(user);

    return REQUEST_KINDS.reduce(
      (acc, kind) => {
        acc[kind] = ACTIVITIES_INVOLVED_BY_REQUEST_KIND[kind].reduce(
          (date: DateTime<true> | null, activityPath: string) => {
            const activityDate = _.get(lastActivities, activityPath) as DateTime<true> | null;
            if (!date) {
              return activityDate;
            }
            if (!activityDate) {
              return date;
            }
            return activityDate > date ? activityDate : date;
          },
          null,
        )!;
        return acc;
      },
      {} as Record<RequestKind, DateTime<true>>,
    );
  }

  private async getKindsToSync(user: UserAuthCtxt): Promise<RequestKind[]> {
    const lastUpdatedAtByKind = await this.userActivitiesRepository.getForUserId(user.id);
    const updatedAtByKind = await this.getLastUpdatedAtByKind(user);
    return REQUEST_KINDS.filter(
      (kind) =>
        !lastUpdatedAtByKind[kind] || !updatedAtByKind[kind] || updatedAtByKind[kind] > lastUpdatedAtByKind[kind],
    );
  }

  private async syncUserTargetedMedias(user: UserWithAuthContext): Promise<void> {
    const kindToSync = await this.getKindsToSync(user);
    SyncService.logger.log(`Syncing user ${user.name} with kinds ${kindToSync}`);

    for (const kind of kindToSync) {
      const medias = await this.requestHandlerByKind[kind](user);
      SyncService.logger.log(`Syncing user ${user.name} kind ${kind} with ${medias.length} medias`);
      await this.requestsRepository.syncMediasForUserAndKind(user, kind, medias);
      await this.userActivitiesRepository.upsert(user.id, kind);
    }
  }

  private async syncAvailableMedias(): Promise<void> {
    const collectedMedias = await this.jellyfin.listAssets();
    SyncService.logger.log(`Collecting ${collectedMedias.length} medias.`);

    const medias: MediaInfos[] = collectedMedias.map(
      (m: JellyfinMedia): MediaInfos => ({
        type: m.Type === 'Movie' ? 'movie' : 'episode',
        imdbId: m.ProviderIds.Imdb ?? '',
        title: m.Type === 'Movie' ? m.Name : (m.SeriesName ?? m.Name),
        year: m.ProductionYear,
        seasonNumber: m.ParentIndexNumber ?? null,
        episodeNumber: m.IndexNumber ?? null,
      }),
    );
    for (const media of medias) {
      await this.mediasRepository.setAvailable(media);
    }
    SyncService.logger.log(`Updating ${medias.length} medias.`);
  }

  // TODO split both syncs
  async start(): Promise<void> {
    SyncService.logger.log('Starting synchronization');

    SyncService.logger.log('Syncing target medias');
    for (const user of await this.listUsers()) {
      await this.syncUserTargetedMedias(user);
    }

    SyncService.logger.log('Syncing collected medias');
    await this.syncAvailableMedias();

    SyncService.logger.log('Synchronization completed');
  }

  // TODO move helpers functions
  private async expandProgressShows(progressShows: ProgressShow[]): Promise<MediaInfos[]> {
    const episodes = await Promise.all(
      progressShows.map((p) =>
        this.bufferedExpansion(p.show, p.next_episode?.season ?? 1, p.next_episode?.number ?? 1),
      ),
    );

    return episodes.flat();
  }

  private async expand(medias: Media[], buffering: boolean = false): Promise<MediaInfos[]> {
    const movies: MediaInfos[] = medias
      .filter((media) => media.type === 'movie')
      .map((m) => ({
        type: 'movie',
        imdbId: m.movie.ids.imdb ?? '',
        title: m.movie.title,
        year: m.movie.year,
        seasonNumber: null,
        episodeNumber: null,
        userIds: [],
      }));
    const episodes: MediaInfos[] = medias
      .filter((media) => media.type === 'episode')
      .map((m) => ({
        type: 'episode',
        imdbId: m.episode.ids.imdb ?? '',
        title: m.show.title,
        year: m.show.year,
        seasonNumber: m.episode.season,
        episodeNumber: m.episode.number,
      }));

    const showExpender = buffering ? this.bufferedExpansion.bind(this) : this.expandShow.bind(this);
    const seasonExpender = buffering ? this.bufferedExpansion.bind(this) : this.expandSeason.bind(this);
    const expandedMedias: Promise<MediaInfos[]>[] = [
      ...medias.filter((media) => media.type === 'show').map((s) => showExpender(s.show)),
      ...medias.filter((media) => media.type === 'season').map((s) => seasonExpender(s.show, s.season.number)),
    ];

    return [...movies, ...episodes, ...(await Promise.all(expandedMedias)).flat()];
  }

  private async expandShow(show: Show): Promise<MediaInfos[]> {
    const showDetails = await this.traktClient.requestShowDetails(show.ids.trakt);
    const seasons = await this.traktClient.requestShowSeasonsDetails(show.ids.trakt);
    const episodes = seasons.flatMap((season) => (season.number > 0 ? season.episodes : []));

    return filterAiredEpisodes(episodes, showDetails.aired_episodes, 0).map((episode) =>
      mapEpisodeToRequest(episode, show),
    );
  }

  private async expandSeason(show: Show, seasonNumber: number): Promise<MediaInfos[]> {
    const showDetails = await this.traktClient.requestShowDetails(show.ids.trakt);
    const seasons = await this.traktClient.requestShowSeasonsDetails(show.ids.trakt);
    const season = seasons.find((s) => s.number === seasonNumber);
    if (!season) {
      return [];
    }

    const startIndex = seasons
      .filter((s) => s.number > 0 && s.number < seasonNumber)
      .reduce((acc, s) => acc + s.episodes.length, 0);

    return filterAiredEpisodes(season.episodes, showDetails.aired_episodes, startIndex).map((episode) =>
      mapEpisodeToRequest(episode, show),
    );
  }

  private async bufferedExpansion(
    show: Show,
    startSeason: number = 1,
    startEpisode: number = 1,
  ): Promise<MediaInfos[]> {
    const showDetails = await this.traktClient.requestShowDetails(show.ids.trakt);
    const seasons = await this.traktClient.requestShowSeasonsDetails(show.ids.trakt);
    const count = showDetails.runtime ? Math.ceil(this.config.bufferDuration / showDetails.runtime) : 3;

    const episodes = seasons.flatMap((season) => {
      if (season.number <= 0) {
        return [];
      }
      return season.episodes;
    });

    const episodeIndex = episodes.findIndex(
      (episode) => episode.season === startSeason && episode.number === startEpisode,
    );

    return episodes
      .slice(episodeIndex, Math.min(episodeIndex + count, showDetails.aired_episodes ?? Infinity))
      .map((episode) => mapEpisodeToRequest(episode, show));
  }
}
