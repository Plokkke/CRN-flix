import { Logger } from '@nestjs/common';
import * as _ from 'lodash';
import { DateTime } from 'luxon';
import { z } from 'zod';

import { concurrent } from '@/helpers/concurrent';
import { TraktPlugin } from '@/modules/jellyfin/plugins/trakt';
import { TraktApi } from '@/modules/trakt/api';
import { Episode, Media, Movie, MovieDetails, ProgressShow, Show, UserAuthCtxt } from '@/modules/trakt/types';
import { MediaInfos, MediasRepository, MediaType } from '@/services/database/medias';
import { RequestsRepository, RequestStatus, SyncRequestSnapshot } from '@/services/database/requests';
import { UserActivitiesRepository } from '@/services/database/user-activities';
import { UsersRepository, type UserEntity } from '@/services/database/users';
import { PlannerService } from '@/services/planner/planner';
import { TicketCategory } from '@/services/tickets/model';
import { TicketService } from '@/services/tickets/ticket.service';

export const syncConfigSchema = z.object({
  ratingThreshold: z.number().int().optional().default(10),
  /** Missing episodes within this window of unwatched viewing time are `needed`. */
  needWindowHours: z.number().positive().optional().default(5),
  /** Soft ceiling on the viewing hours one action may pull in. */
  maxWindowHours: z.number().positive().optional().default(25),
  fullSyncIntervalHours: z.number().int().positive().optional().default(24),
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

const NEW_REQUEST_CONCURRENCY = 5;

// --- Per-media types ---

// --- Gather types ---

type DesiredMedia = {
  mediaInfos: MediaInfos;
  requestKindsByUserId: Record<UserEntity['id'], Set<RequestKind>>;
};

type GatheredData = {
  desiredMediaByKey: Record<MediaCompositeKey, DesiredMedia>;
  syncedKindsByUserId: Record<UserEntity['id'], Set<RequestKind>>;
  mediaRequests: SyncRequestSnapshot[];
};

// --- Helpers ---

function mapEpisodeToRequest(episode: Episode, show: Show, runtimeMinutes: number | null): MediaInfos {
  return {
    type: MediaType.Episode,
    title: show.title,
    originalTitle: null,
    frenchTitle: null,
    originalLanguage: null,
    year: show.year,
    imdbId: show.ids.imdb ?? '',
    seasonNumber: episode.season,
    episodeNumber: episode.number,
    runtimeMinutes,
    traktSlug: show.ids.slug ?? null,
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

export class TraktSyncService {
  private static readonly logger = new Logger(TraktSyncService.name);

  private readonly requestHandlerByKind: Record<RequestKind, (user: UserAuthCtxt) => Promise<MediaInfos[]>> = {
    WATCHLISTED: async (user) => {
      const watchlistedMedias = await this.traktClient.requestUserWatchlist(user, true);
      return this.expand(watchlistedMedias);
    },
    // LISTED: async (user) => {
    //   const listedMedias = await this.traktClient.requestUserList(user, 'Jellyfin');
    //   return this.expand(listedMedias, false);
    // },
    HIGH_RATED: async (user) => {
      const highRatedMedias = await this.traktClient.getHighRatedMedias(user, this.config.ratingThreshold);
      return this.expand(highRatedMedias);
    },
    PROGRESS: async (user) => {
      const progressShows = await this.traktClient.getWatchingShows(user);
      return this.expandProgressShows(user, progressShows);
    },
  };

  constructor(
    private readonly config: SyncConfig,
    private readonly traktPlugin: TraktPlugin,
    private readonly traktClient: TraktApi,
    private readonly usersRepository: UsersRepository,
    private readonly userActivitiesRepository: UserActivitiesRepository,
    private readonly mediasRepository: MediasRepository,
    private readonly requestsRepository: RequestsRepository,
    private readonly planner: PlannerService,
    private readonly ticketService: TicketService,
  ) {}

  async sync(): Promise<void> {
    TraktSyncService.logger.log('Starting Trakt sync');

    const gathered = await this.gather();
    const mediaRequestByKey = _.keyBy(gathered.mediaRequests, (r) => compositeKey(r));

    // Existing requests: sync user reasons (synchronous, no API calls)
    for (const snapshot of gathered.mediaRequests) {
      const desiredKindsByUserId = gathered.desiredMediaByKey[compositeKey(snapshot)]?.requestKindsByUserId ?? {};
      await this.syncRequestReasons(snapshot, desiredKindsByUserId, gathered.syncedKindsByUserId);
    }

    // New requests: persist + query indexers concurrently
    const newMediaRequests = Object.entries(gathered.desiredMediaByKey).filter(([key]) => !mediaRequestByKey[key]);
    TraktSyncService.logger.log(
      `Processing ${newMediaRequests.length} new medias (concurrency: ${NEW_REQUEST_CONCURRENCY})`,
    );

    const createdIds = await concurrent(newMediaRequests, NEW_REQUEST_CONCURRENCY, ([, desired]) =>
      this.processNewRequest(desired),
    );

    const mediaIdByKey: Record<MediaCompositeKey, string> = {};
    for (const snapshot of gathered.mediaRequests) {
      mediaIdByKey[compositeKey(snapshot)] = snapshot.mediaId;
    }
    newMediaRequests.forEach(([key], index) => {
      if (createdIds[index]) {
        mediaIdByKey[key] = createdIds[index];
      }
    });
    await this.openMissingImdbTickets(gathered, mediaIdByKey);

    // Update activity timestamps
    for (const [userId, kinds] of Object.entries(gathered.syncedKindsByUserId)) {
      for (const kind of kinds) {
        await this.userActivitiesRepository.upsert(userId, kind);
      }
    }

    TraktSyncService.logger.log('Trakt sync completed');
  }

  // --- Phase 1: GATHER ---

  private async gather(): Promise<GatheredData> {
    const users = await this.listUsers();

    TraktSyncService.logger.log('Gathering Trakt activities');
    const desiredMediaByKey: Record<MediaCompositeKey, DesiredMedia> = {};
    const syncedKindsByUserId: GatheredData['syncedKindsByUserId'] = {};

    for (const user of users) {
      syncedKindsByUserId[user.id] = await this.getKindsToSync(user);
      TraktSyncService.logger.log(
        `User ${user.name}: syncing kinds ${Array.from(syncedKindsByUserId[user.id]).join(', ')}`,
      );

      for (const kind of syncedKindsByUserId[user.id]) {
        const medias = await this.requestHandlerByKind[kind](user);
        TraktSyncService.logger.log(`User ${user.name} kind ${kind}: ${medias.length} medias`);

        for (const media of medias) {
          const key = compositeKey(media);
          const entry =
            desiredMediaByKey[key] ?? (desiredMediaByKey[key] = { mediaInfos: media, requestKindsByUserId: {} });
          entry.requestKindsByUserId[user.id] ??= new Set();
          entry.requestKindsByUserId[user.id].add(kind);
        }
      }
    }

    TraktSyncService.logger.log(
      `Gathered ${Object.keys(desiredMediaByKey).length} unique desired medias across ${users.length} users`,
    );

    TraktSyncService.logger.log('Snapshotting current DB state');
    const desiredKeys = Object.values(desiredMediaByKey).map((d) => d.mediaInfos);
    const mediaRequests = await this.requestsRepository.listSyncSnapshot(desiredKeys, Object.keys(syncedKindsByUserId));
    TraktSyncService.logger.log(`Current requests: ${mediaRequests.length}`);

    return { desiredMediaByKey, syncedKindsByUserId, mediaRequests };
  }

  // --- Per-media sync ---

  private async syncRequestReasons(
    request: SyncRequestSnapshot,
    desiredKindsByUserId: Record<UserEntity['id'], Set<RequestKind>>,
    syncedKindsByUserId: Record<UserEntity['id'], Set<RequestKind>>,
  ): Promise<void> {
    const existingReasonsByUserId = new Map(
      (request.userReasons ?? []).map((ur) => [ur.userId, new Set(<RequestKind[]>ur.reasons)]),
    );

    for (const [userId, concernedKinds] of Object.entries(syncedKindsByUserId)) {
      const desiredKinds = desiredKindsByUserId[userId] ?? new Set<RequestKind>();
      const existingKinds = existingReasonsByUserId.get(userId) ?? new Set<RequestKind>();

      for (const kind of concernedKinds) {
        if (desiredKinds.has(kind) && !existingKinds.has(kind)) {
          await this.requestsRepository.setUserRequestReason(request.mediaId, userId, kind);
        } else if (!desiredKinds.has(kind) && existingKinds.has(kind)) {
          await this.requestsRepository.removeUserRequestReason(request.mediaId, userId, kind);
        }
      }
    }
  }

  /** Request creation only writes intent; the planner reacts to the NOTIFY events. */
  private async processNewRequest(desiredMedia: DesiredMedia): Promise<string | null> {
    try {
      const media = await this.mediasRepository.upsert(desiredMedia.mediaInfos);
      await this.requestsRepository.upsert(media.id, RequestStatus.Missing);

      for (const [userId, reasons] of Object.entries(desiredMedia.requestKindsByUserId)) {
        await this.requestsRepository.setUserRequestReasons(media.id, userId, reasons);
      }
      return media.id;
    } catch (error) {
      TraktSyncService.logger.error(
        `Failed to create request for "${desiredMedia.mediaInfos.title}" (${desiredMedia.mediaInfos.imdbId}): ${error instanceof Error ? error.message : error}`,
      );
      return null;
    }
  }

  /**
   * Trakt sometimes has no IMDb id for a title; the planner can never search those.
   * One ticket per title lets the admin unblock the group by replying the id.
   */
  private async openMissingImdbTickets(
    gathered: GatheredData,
    mediaIdByKey: Record<MediaCompositeKey, string>,
  ): Promise<void> {
    const orphanGroups = _.groupBy(
      Object.entries(gathered.desiredMediaByKey).filter(([, d]) => d.mediaInfos.imdbId === ''),
      ([, d]) => `${d.mediaInfos.type}:${d.mediaInfos.title}:${d.mediaInfos.year ?? ''}`,
    );

    for (const entries of Object.values(orphanGroups)) {
      const { title, year, type } = entries[0][1].mediaInfos;
      const mediaIds = entries.map(([key]) => mediaIdByKey[key]).filter((id): id is string => !!id);
      if (mediaIds.length === 0) {
        continue;
      }

      const kind = type === MediaType.Movie ? ('movie' as const) : ('show' as const);
      const subject =
        kind === 'movie'
          ? { type: 'media' as const, id: mediaIds[0] }
          : { type: 'show' as const, id: `${title}:${year ?? ''}`.toLowerCase().slice(0, 64) };

      await this.ticketService.open(
        TicketCategory.MissingImdb,
        subject,
        { title, year, kind, mediaIds },
        { title: `IMDb inconnu — ${title}${year ? ` (${year})` : ''}` },
      );
    }
  }

  // --- Shared helpers (unchanged) ---

  private async listUsers(): Promise<UserWithAuthContext[]> {
    const users = await this.usersRepository.list();
    TraktSyncService.logger.log(`Found ${users.length} users in database`);

    const authContexts = await this.traktPlugin.getUsersAuthContext();
    TraktSyncService.logger.log(`Found ${authContexts.length} users with Trakt auth context`);

    const matchedUsers = authContexts
      .map(
        (authContext): UserWithAuthContext => ({
          ...authContext,
          ...users.find((user) => user.jellyfinId === authContext.jellyfinId)!,
        }),
      )
      .filter((user) => user.id);

    TraktSyncService.logger.log(`Matched ${matchedUsers.length} users for sync`);
    return matchedUsers;
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
    const allKinds = Object.values(RequestKind);

    const fullSyncCutoff = DateTime.now().minus({ hours: this.config.fullSyncIntervalHours });
    const needsFullSync = allKinds.some((kind) => {
      const lastSync = lastUpdatedAtByKind[kind];
      return !lastSync || lastSync < fullSyncCutoff;
    });

    if (needsFullSync) {
      TraktSyncService.logger.log(
        `User ${user.id}: forcing full sync (no kind synced within ${this.config.fullSyncIntervalHours}h)`,
      );
      return new Set(allKinds);
    }

    const updatedAtByKind = await this.getLastUpdatedAtByKind(user);
    return new Set(
      allKinds.filter(
        (kind) =>
          !lastUpdatedAtByKind[kind] || !updatedAtByKind[kind] || updatedAtByKind[kind] > lastUpdatedAtByKind[kind],
      ),
    );
  }

  /**
   * Full show expansion: watched episodes are simply already fulfilled or not wanted.
   * Playheads belong to Trakt (read live by the planner, never stored); this pass only
   * runs when Trakt activities changed, so it doubles as the re-plan signal.
   */
  private async expandProgressShows(user: UserAuthCtxt, progressShows: ProgressShow[]): Promise<MediaInfos[]> {
    const episodes = await Promise.all(
      progressShows.map(async (p) => {
        const imdbId = p.show.ids.imdb;
        if (imdbId) {
          this.planner.schedulePass({ kind: 'show', imdbId });
        }

        const expanded = await this.expandShow(p.show);
        TraktSyncService.logger.log(`[progress.expand] "${p.show.title}" → ${expanded.length} episode(s)`);
        return expanded;
      }),
    );

    return episodes.flat();
  }

  private async expand(medias: Media[]): Promise<MediaInfos[]> {
    const movies: MediaInfos[] = await Promise.all(
      medias
        .filter((media) => media.type === 'movie')
        .map(async (m) => ({
          type: MediaType.Movie,
          imdbId: m.movie.ids.imdb ?? '',
          title: m.movie.title,
          originalTitle: null,
          frenchTitle: null,
          originalLanguage: null,
          year: m.movie.year,
          seasonNumber: null,
          episodeNumber: null,
          runtimeMinutes: await this.movieRuntime(m.movie),
          traktSlug: m.movie.ids.slug ?? null,
        })),
    );
    const episodes: MediaInfos[] = medias
      .filter((media) => media.type === 'episode')
      .map((m) => ({
        type: MediaType.Episode,
        imdbId: m.show.ids.imdb ?? '',
        title: m.show.title,
        originalTitle: null,
        frenchTitle: null,
        originalLanguage: null,
        year: m.show.year,
        seasonNumber: m.episode.season,
        episodeNumber: m.episode.number,
        runtimeMinutes: null,
        traktSlug: m.show.ids.slug ?? null,
      }));

    const expandedMedias: Promise<MediaInfos[]>[] = [
      ...medias.filter((media) => media.type === 'show').map((s) => this.expandShow(s.show)),
      ...medias.filter((media) => media.type === 'season').map((s) => this.expandSeason(s.show, s.season.number)),
    ];

    return [...movies, ...episodes, ...(await Promise.all(expandedMedias)).flat()];
  }

  /**
   * The size cap silently passes without a runtime: never store a movie without one.
   * Watchlist items fetched with `extended=full` already carry it; other sources cost one cached call.
   */
  private async movieRuntime(movie: Movie | MovieDetails): Promise<number | null> {
    if ('runtime' in movie && movie.runtime !== null) {
      return movie.runtime;
    }
    try {
      return (await this.traktClient.requestMovieDetails(movie.ids.trakt)).runtime;
    } catch (error) {
      TraktSyncService.logger.warn(
        `Runtime unavailable for movie "${movie.title}": ${error instanceof Error ? error.message : error}`,
      );
      return null;
    }
  }

  private async expandShow(show: Show): Promise<MediaInfos[]> {
    const showDetails = await this.traktClient.requestShowDetails(show.ids.trakt);
    const seasons = await this.traktClient.requestShowSeasonsDetails(show.ids.trakt);
    const episodes = seasons.flatMap((season) => (season.number > 0 ? season.episodes : []));

    return filterAiredEpisodes(episodes, showDetails.aired_episodes, 0).map((episode) =>
      mapEpisodeToRequest(episode, show, showDetails.runtime),
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
      mapEpisodeToRequest(episode, show, showDetails.runtime),
    );
  }
}
