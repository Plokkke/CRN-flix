import { Logger } from '@nestjs/common';
import * as _ from 'lodash';
import { z } from 'zod';

import { TraktApi } from '@/modules/trakt/api';
import { Episode, Media, ProgressShow, ReleasedMedia, Show, UserAuthCtxt } from '@/modules/trakt/types';
import { MediaRequestInfos } from '@/services/database/mediaRequests';

export const configSchema = z.object({
  ratingThreshold: z.number().int().optional().default(10),
  ratedLimit: z.number().int().optional().default(80),
  wantedLimit: z.number().int().optional().default(30),
  progressLimit: z.number().int().optional().default(10),
  bufferDuration: z.number().int().optional().default(150),
});

export type Config = z.infer<typeof configSchema>;

function mediaRequestPusherFor(user: UserAuthCtxt) {
  return (mediaRequests: MediaRequestInfos[], media: MediaRequestInfos): MediaRequestInfos[] =>
    pushMediaRequest(mediaRequests, media, user);
}

function pushMediaRequest(
  mediaRequests: MediaRequestInfos[],
  mediaRequest: MediaRequestInfos,
  user: UserAuthCtxt,
): MediaRequestInfos[] {
  let matchingMedia: MediaRequestInfos | undefined = mediaRequests.find((m) => m.imdbId === mediaRequest.imdbId);

  if (!matchingMedia) {
    matchingMedia = mediaRequest;
    mediaRequests.push(matchingMedia);
  }

  matchingMedia.userIds = _.uniq([...matchingMedia.userIds, user.id]);

  return mediaRequests;
}

export class SyncService {
  private static readonly logger = new Logger(SyncService.name);

  constructor(
    private traktClient: TraktApi,
    private config: Config,
  ) {
    configSchema.parse(config);
  }

  async listTargetMedias(users: UserAuthCtxt[]): Promise<MediaRequestInfos[]> {
    return users.reduce(
      async (pMediaRequests: Promise<MediaRequestInfos[]>, user: UserAuthCtxt): Promise<MediaRequestInfos[]> => {
        const userWantedMedias = await this.listTargetMediasFor(user);
        return userWantedMedias.reduce(mediaRequestPusherFor(user), await pMediaRequests);
      },
      Promise.resolve([]),
    );
  }

  private async listTargetMediasFor(user: UserAuthCtxt): Promise<MediaRequestInfos[]> {
    return [
      ...(await this.listProgressShows(user)),
      ...(await this.listWantedMedias(user)),
      // ...(await this.listHighRatedMedias(user)),
      // ...(await this.listListedMedias(user, 'Jellyfin')),
    ];
  }

  private async listHighRatedMedias(user: UserAuthCtxt): Promise<MediaRequestInfos[]> {
    const highRatedMedias: Media[] = _.take(
      _.orderBy(
        await this.traktClient.getHighRatedMedias(user, this.config.ratingThreshold),
        ['rating', 'rated_at'],
        ['desc', 'desc'],
      ),
      this.config.ratedLimit,
    );

    return this.expand(highRatedMedias, false);
  }

  private async listWantedMedias(user: UserAuthCtxt): Promise<MediaRequestInfos[]> {
    const listedMedias: ReleasedMedia[] = _.take(
      await this.traktClient.requestUserWatchlist(user, true),
      this.config.wantedLimit,
    );

    return this.expand(listedMedias, true);
  }

  private async listListedMedias(user: UserAuthCtxt, listName: string): Promise<MediaRequestInfos[]> {
    const listedMedias: ReleasedMedia[] = _.take(await this.traktClient.requestUserList(user, listName), Infinity);

    return this.expand(listedMedias, false);
  }

  private async listProgressShows(user: UserAuthCtxt): Promise<MediaRequestInfos[]> {
    const inProgressShows: ProgressShow[] = _.take(
      _.orderBy(await this.traktClient.getWatchingShows(user), ['last_watched_at'], ['desc']),
      this.config.progressLimit,
    );

    const episodes = await Promise.all(
      inProgressShows.map((p) =>
        this.bufferedExpansion(p.show, p.next_episode?.season ?? 1, p.next_episode?.number ?? 1),
      ),
    );

    return episodes.flat();
  }

  private async expand(medias: Media[], buffering: boolean = false): Promise<MediaRequestInfos[]> {
    const movies: MediaRequestInfos[] = medias
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
    const episodes: MediaRequestInfos[] = medias
      .filter((media) => media.type === 'episode')
      .map((m) => ({
        type: 'episode',
        imdbId: m.episode.ids.imdb ?? '',
        title: m.show.title,
        year: m.show.year,
        seasonNumber: m.episode.season,
        episodeNumber: m.episode.number,
        userIds: [],
      }));

    const showExpender = buffering ? this.bufferedExpansion.bind(this) : this.expandShow.bind(this);
    const seasonExpender = buffering ? this.bufferedExpansion.bind(this) : this.expandSeason.bind(this);
    const expandedMedias: Promise<MediaRequestInfos[]>[] = [
      ...medias.filter((media) => media.type === 'show').map((s) => showExpender(s.show)),
      ...medias.filter((media) => media.type === 'season').map((s) => seasonExpender(s.show, s.season.number)),
    ];

    return [...movies, ...episodes, ...(await Promise.all(expandedMedias)).flat()];
  }

  private mapEpisodeToRequest(episode: Episode, show: Show): MediaRequestInfos {
    return {
      type: 'episode',
      title: show.title,
      year: show.year,
      imdbId: episode.ids.imdb ?? '',
      seasonNumber: episode.season,
      episodeNumber: episode.number,
      userIds: [],
    };
  }

  private filterAiredEpisodes(episodes: Episode[], airedEpisodes: number | null, startIndex: number): Episode[] {
    if (airedEpisodes === null) {
      return [];
    }
    const availableEpisodes = Math.max(0, airedEpisodes - startIndex);
    return episodes.slice(0, availableEpisodes);
  }

  private async expandShow(show: Show): Promise<MediaRequestInfos[]> {
    const showDetails = await this.traktClient.requestShowDetails(show.ids.trakt);
    const seasons = await this.traktClient.requestShowSeasonsDetails(show.ids.trakt);
    const episodes = seasons.flatMap((season) => (season.number > 0 ? season.episodes : []));

    return this.filterAiredEpisodes(episodes, showDetails.aired_episodes, 0).map((episode) =>
      this.mapEpisodeToRequest(episode, show),
    );
  }

  private async expandSeason(show: Show, seasonNumber: number): Promise<MediaRequestInfos[]> {
    const showDetails = await this.traktClient.requestShowDetails(show.ids.trakt);
    const seasons = await this.traktClient.requestShowSeasonsDetails(show.ids.trakt);
    const season = seasons.find((s) => s.number === seasonNumber);
    if (!season) {
      return [];
    }

    const startIndex = seasons
      .filter((s) => s.number > 0 && s.number < seasonNumber)
      .reduce((acc, s) => acc + s.episodes.length, 0);

    return this.filterAiredEpisodes(season.episodes, showDetails.aired_episodes, startIndex).map((episode) =>
      this.mapEpisodeToRequest(episode, show),
    );
  }

  private async bufferedExpansion(
    show: Show,
    startSeason: number = 1,
    startEpisode: number = 1,
  ): Promise<MediaRequestInfos[]> {
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
      .map((episode) => this.mapEpisodeToRequest(episode, show));
  }
}
