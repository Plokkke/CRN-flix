import { Logger } from '@nestjs/common';
import * as _ from 'lodash';
import { DateTime } from 'luxon';
import { z } from 'zod';

import { DarkiworldService } from '@/modules/darkiworld/service';
import { JellyfinMedia, JellyfinMediaService } from '@/modules/jellyfin/jellyfin';
import { TraktPlugin } from '@/modules/jellyfin/plugins/trakt';
import { TraktApi } from '@/modules/trakt/api';
import { Episode, Media, ProgressShow, Show, UserAuthCtxt } from '@/modules/trakt/types';
import { MediaInfos, MediasRepository, MediaType } from '@/services/database/medias';
import { RequestEntity, RequestsRepository, RequestStatus } from '@/services/database/requests';
import { UserActivitiesRepository } from '@/services/database/user-activities';
import { UsersRepository, type UserEntity } from '@/services/database/users';

export const syncConfigSchema = z.object({
  ratingThreshold: z.number().int().optional().default(10),
  ratedLimit: z.number().int().optional().default(80),
  wantedLimit: z.number().int().optional().default(30),
  progressLimit: z.number().int().optional().default(10),
  bufferDuration: z.number().int().optional().default(150),
});

export type SyncConfig = z.infer<typeof syncConfigSchema>;

export enum RequestKind {
  Watchlisted = 'WATCHLISTED',
  // Listed = 'LISTED',
  Progress = 'PROGRESS',
  HighRated = 'HIGH_RATED',
}

export const ACTIVITIES_INVOLVED_BY_REQUEST_KIND: Record<RequestKind, string[]> = {
  [RequestKind.Watchlisted]: ['watchlist.updated_at'],
  // [RequestKind.Listed]: ['lists.liked_at'],
  [RequestKind.HighRated]: ['movies.rated_at', 'episodes.rated_at', 'shows.rated_at', 'seasons.rated_at'],
  [RequestKind.Progress]: ['shows.hidden_at', 'shows.dropped_at', 'movies.watched_at', 'episodes.watched_at'],
};

type MediaCompositeKey = string;

function compositeKey(media: Pick<MediaInfos, 'imdbId' | 'seasonNumber' | 'episodeNumber'>): MediaCompositeKey {
  return `${media.imdbId}:${media.seasonNumber ?? -1}:${media.episodeNumber ?? -1}`;
}

// --- Changeset types ---

type RequestToCreate = {
  mediaInfos: MediaInfos;
  finalStatus: RequestStatus;
  darkiworldTitleId: number | null;
  darkiworldUrl: string | null;
  requestKindsByUserId: Record<UserEntity['id'], Set<RequestKind>>;
};

type UserReasonToAdd = {
  mediaId: string;
  userId: string;
  reason: RequestKind;
};

type UserReasonToRemove = {
  mediaId: string;
  userId: string;
  reason: RequestKind;
};

type SyncChangeset = {
  requestsToCreate: RequestToCreate[];
  userReasonsToAdd: UserReasonToAdd[];
  userReasonsToRemove: UserReasonToRemove[];
};

// --- Gather types ---

type DesiredMedia = {
  mediaInfos: MediaInfos;
  requestKindsByUserId: Record<UserEntity['id'], Set<RequestKind>>;
};

type GatheredData = {
  jellyfinAssets: Set<MediaCompositeKey>;
  desiredMediaByKey: Record<MediaCompositeKey, DesiredMedia>;
  syncedKindsByUser: Record<UserEntity['id'], Set<RequestKind>>;
  mediaRequests: RequestEntity[];
};

// --- Helpers ---

function mapEpisodeToRequest(episode: Episode, show: Show): MediaInfos {
  return {
    type: MediaType.Episode,
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
    // LISTED: async (user) => {
    //   const listedMedias = await this.traktClient.requestUserList(user, 'Jellyfin');
    //   return this.expand(listedMedias, false);
    // },
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
    private readonly darkiworldService: DarkiworldService,
  ) {}

  async start(): Promise<void> {
    SyncService.logger.log('Starting batch synchronization');

    const gathered = await this.gather();

    SyncService.logger.log('Computing changeset');
    const changeset = await this.compute(gathered);

    SyncService.logger.log(
      `Changeset: ${changeset.requestsToCreate.length} new, ` +
        `${changeset.userReasonsToAdd.length} user adds, ` +
        `${changeset.userReasonsToRemove.length} user removes`,
    );

    await this.apply(changeset);

    for (const [userId, kinds] of Object.entries(gathered.syncedKindsByUser)) {
      for (const kind of kinds) {
        await this.userActivitiesRepository.upsert(userId, kind);
      }
    }

    SyncService.logger.log('Batch synchronization completed');
  }

  // --- Phase 1: GATHER ---

  private async gather(): Promise<GatheredData> {
    const users = await this.listUsers();

    SyncService.logger.log('Gathering Trakt activities');
    const desiredMediaByKey: Record<MediaCompositeKey, DesiredMedia> = {};
    const syncedKindsByUser: GatheredData['syncedKindsByUser'] = {};

    for (const user of users) {
      syncedKindsByUser[user.id] = await this.getKindsToSync(user);
      SyncService.logger.log(`User ${user.name}: syncing kinds ${Array.from(syncedKindsByUser[user.id]).join(', ')}`);

      for (const kind of syncedKindsByUser[user.id]) {
        const medias = await this.requestHandlerByKind[kind](user);
        SyncService.logger.log(`User ${user.name} kind ${kind}: ${medias.length} medias`);

        for (const media of medias) {
          const key = compositeKey(media);
          const entry =
            desiredMediaByKey[key] ?? (desiredMediaByKey[key] = { mediaInfos: media, requestKindsByUserId: {} });
          entry.requestKindsByUserId[user.id] ??= new Set();
          entry.requestKindsByUserId[user.id].add(kind);
        }
      }
    }

    SyncService.logger.log('Gathering Jellyfin assets');
    const jellyfinMedias = await this.jellyfin.listAssets();
    const jellyfinAssets = new Set(
      jellyfinMedias.map((m: JellyfinMedia) =>
        compositeKey({
          imdbId: m.ProviderIds.Imdb,
          seasonNumber: m.ParentIndexNumber ?? null,
          episodeNumber: m.IndexNumber ?? null,
        }),
      ),
    );
    SyncService.logger.log(`Jellyfin: ${jellyfinAssets.size} assets`);

    SyncService.logger.log('Snapshotting current DB state');
    const mediaRequests = await this.requestsRepository.listAllWithDetails();
    SyncService.logger.log(`Current requests: ${mediaRequests.length}`);

    return { jellyfinAssets, desiredMediaByKey, syncedKindsByUser, mediaRequests };
  }

  // --- Phase 2: COMPUTE ---

  private async compute({
    jellyfinAssets,
    desiredMediaByKey,
    syncedKindsByUser,
    mediaRequests,
  }: GatheredData): Promise<SyncChangeset> {
    const changeset: SyncChangeset = {
      requestsToCreate: [],
      userReasonsToAdd: [],
      userReasonsToRemove: [],
    };

    const mediaRequestByKey = <Record<MediaCompositeKey, RequestEntity>>(
      _.keyBy(mediaRequests, (mediaRequest) => compositeKey(mediaRequest.media!))
    );

    // Darkiworld cache to avoid duplicate checks
    const darkiworldCache = new Map<MediaCompositeKey, { titleId: number | null; url: string | null }>();

    // New requests
    for (const [mediaKey, desiredMedia] of Object.entries(desiredMediaByKey)) {
      if (!mediaRequestByKey[mediaKey]) {
        await this.registerNewRequest(changeset, mediaKey, desiredMedia, jellyfinAssets, darkiworldCache);
      }
    }

    // Existing requests - diff user associations
    for (const request of mediaRequests) {
      const desiredKindsByUserId = desiredMediaByKey[compositeKey(request.media!)]?.requestKindsByUserId ?? {};
      this.registerRequestReasonChanges(changeset, request, desiredKindsByUserId, syncedKindsByUser);
    }

    return changeset;
  }

  private registerRequestReasonChanges(
    changeset: SyncChangeset,
    request: RequestEntity,
    desiredKindsByUserId: Record<UserEntity['id'], Set<RequestKind>>,
    syncedKindsByUser: Record<UserEntity['id'], Set<RequestKind>>,
  ): void {
    const existingReasonsByUserId = new Map(
      (request.userRequests ?? []).map((ur) => [ur.userId, new Set(<RequestKind[]>ur.reasons)]),
    );

    // For each kind being synced of each user
    for (const [userId, syncedKinds] of Object.entries(syncedKindsByUser)) {
      const desiredKinds = desiredKindsByUserId[userId] ?? new Set<RequestKind>();
      const existingKinds = existingReasonsByUserId.get(userId) ?? new Set<RequestKind>();

      for (const kind of syncedKinds) {
        if (desiredKinds.has(kind) && !existingKinds.has(kind)) {
          // If the kind is desired but not currently associated, add it
          changeset.userReasonsToAdd.push({ mediaId: request.mediaId, userId, reason: kind });
        } else if (!desiredKinds.has(kind) && existingKinds.has(kind)) {
          // If the kind is not desired but currently associated, remove it
          changeset.userReasonsToRemove.push({ mediaId: request.mediaId, userId, reason: kind });
        }
      }
    }
  }

  private async registerNewRequest(
    changeset: SyncChangeset,
    mediaKey: MediaCompositeKey,
    desiredMedia: DesiredMedia,
    jellyfinAssets: Set<MediaCompositeKey>,
    darkiworldCache: Map<MediaCompositeKey, { titleId: number | null; url: string | null }>,
  ): Promise<void> {
    let finalStatus: RequestStatus = RequestStatus.Missing;
    let darkiworldTitleId: number | null = null;
    let darkiworldUrl: string | null = null;

    if (jellyfinAssets.has(mediaKey)) {
      finalStatus = RequestStatus.Fulfilled;
    } else {
      const darkiResult = await this.checkDarkiworld(mediaKey, desiredMedia.mediaInfos, darkiworldCache);
      darkiworldTitleId = darkiResult.titleId;
      darkiworldUrl = darkiResult.url;
      if (darkiResult.url) {
        finalStatus = RequestStatus.Pending;
      }
    }

    changeset.requestsToCreate.push({
      mediaInfos: desiredMedia.mediaInfos,
      finalStatus,
      darkiworldTitleId,
      darkiworldUrl,
      requestKindsByUserId: desiredMedia.requestKindsByUserId,
    });
  }

  private async checkDarkiworld(
    mediaKey: MediaCompositeKey,
    mediaInfos: MediaInfos,
    cache: Map<MediaCompositeKey, { titleId: number | null; url: string | null }>,
  ): Promise<{ titleId: number | null; url: string | null }> {
    const cached = cache.get(mediaKey);
    if (cached) {
      return cached;
    }

    try {
      const result = await this.darkiworldService.find(mediaInfos);
      const entry = {
        titleId: result.title?.id ?? null,
        url: result.available ? result.downloadUrl : null,
      };
      cache.set(mediaKey, entry);
      return entry;
    } catch (error) {
      SyncService.logger.error(`Darkiworld check failed for "${mediaInfos.title}" (${mediaInfos.imdbId})`, error);
      const entry = { titleId: null, url: null };
      cache.set(mediaKey, entry);
      return entry;
    }
  }

  // --- Phase 3: APPLY ---

  private async apply(changeset: SyncChangeset): Promise<void> {
    SyncService.logger.log('Applying changeset');

    // Create new requests with final status
    for (const req of changeset.requestsToCreate) {
      const media = await this.mediasRepository.create(req.mediaInfos);
      await this.requestsRepository.createWithStatus(
        media.id,
        req.finalStatus,
        req.darkiworldTitleId,
        req.darkiworldUrl,
      );

      for (const [userId, reasons] of Object.entries(req.requestKindsByUserId)) {
        await this.requestsRepository.setUserRequestReasons(media.id, userId, reasons);
      }
    }

    // Add user reasons to existing requests
    for (const add of changeset.userReasonsToAdd) {
      await this.requestsRepository.setUserRequestReason(add.mediaId, add.userId, add.reason);
    }

    // Remove user reasons from existing requests
    for (const remove of changeset.userReasonsToRemove) {
      await this.requestsRepository.removeUserRequestReason(remove.mediaId, remove.userId, remove.reason);
    }
  }

  // --- Shared helpers (unchanged) ---

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

    return Object.values(RequestKind).reduce(
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

  private async getKindsToSync(user: UserAuthCtxt): Promise<Set<RequestKind>> {
    const lastUpdatedAtByKind = await this.userActivitiesRepository.getForUserId(user.id);
    const updatedAtByKind = await this.getLastUpdatedAtByKind(user);
    return new Set(
      Object.values(RequestKind).filter(
        (kind) =>
          !lastUpdatedAtByKind[kind] || !updatedAtByKind[kind] || updatedAtByKind[kind] > lastUpdatedAtByKind[kind],
      ),
    );
  }

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
        type: MediaType.Movie,
        imdbId: m.movie.ids.imdb ?? '',
        title: m.movie.title,
        year: m.movie.year,
        seasonNumber: null,
        episodeNumber: null,
      }));
    const episodes: MediaInfos[] = medias
      .filter((media) => media.type === 'episode')
      .map((m) => ({
        type: MediaType.Episode,
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
