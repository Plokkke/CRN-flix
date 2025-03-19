import { Logger } from '@nestjs/common';
import * as _ from 'lodash';
import { z } from 'zod';

import { TraktApi } from '@/modules/trakt/TraktApi';
import { Media, ProgressShow, ReleasedMedia, Show, UserAuthCtxt, WantedMedia } from '@/modules/trakt/types';

export const configSchema = z.object({
  ratingThreshold: z.number().int().optional().default(10),
  ratedLimit: z.number().int().optional().default(80),
  wantedLimit: z.number().int().optional().default(30),
  progressLimit: z.number().int().optional().default(10),
  bufferDuration: z.number().int().optional().default(150),
});

export type Config = z.infer<typeof configSchema>;

function isMovie(media: Media, id: number): boolean {
  return media.type === 'movie' && media.movie.ids.trakt === id;
}

function isShow(media: Media, id: number): boolean {
  return media.type === 'show' && media.show.ids.trakt === id;
}

function isSeason(media: Media, showId: number, seasonNumber: number): boolean {
  return media.type === 'season' && media.show.ids.trakt === showId && media.season.number === seasonNumber;
}

function isEpisode(media: Media, showId: number, seasonNumber: number, episodeNumber: number): boolean {
  return (
    media.type === 'episode' &&
    media.show.ids.trakt === showId &&
    media.episode.season === seasonNumber &&
    media.episode.number === episodeNumber
  );
}

function isPartOfShow(media: Media, showId: number): boolean {
  return (media.type === 'season' || media.type === 'episode') && media.show.ids.trakt === showId;
}

function isPartOfSeason(media: Media, showId: number, seasonNumber: number): boolean {
  return media.type === 'episode' && media.show.ids.trakt === showId && media.episode.season === seasonNumber;
}

function wantedMediaPusherFor(user: UserAuthCtxt) {
  return (wantedMedias: WantedMedia[], media: Media): WantedMedia[] => pushWantedMedia(wantedMedias, media, user);
}

function pushWantedMedia(wantedMedias: WantedMedia[], media: Media, user: UserAuthCtxt): WantedMedia[] {
  let matchingMedia: WantedMedia | undefined;
  let replacingMedias: WantedMedia[] = [];

  if (media.type === 'movie') {
    matchingMedia = wantedMedias.find((m) => isMovie(m.media, media.movie.ids.trakt));
  } else if (media.type === 'show') {
    matchingMedia = wantedMedias.find((m) => isShow(m.media, media.show.ids.trakt));
    replacingMedias = wantedMedias.filter((m) => isPartOfShow(m.media, media.show.ids.trakt));
  } else if (media.type === 'season') {
    matchingMedia = wantedMedias.find(
      (m) => isShow(m.media, media.show.ids.trakt) && isSeason(m.media, media.show.ids.trakt, media.season.number),
    );
    replacingMedias = wantedMedias.filter((m) => isPartOfSeason(m.media, media.show.ids.trakt, media.season.number));
  } else if (media.type === 'episode') {
    matchingMedia = wantedMedias.find(
      (m) =>
        isShow(m.media, media.show.ids.trakt) ||
        isSeason(m.media, media.show.ids.trakt, media.episode.season) ||
        isEpisode(m.media, media.show.ids.trakt, media.episode.season, media.episode.number),
    );
  }

  if (!matchingMedia) {
    matchingMedia = { media, userIds: [] };
    wantedMedias.push(matchingMedia);
  }

  matchingMedia.userIds = _.uniq([...matchingMedia.userIds, replacingMedias.flatMap((m) => m.userIds), user.id].flat());

  for (const replacingMedia of replacingMedias) {
    _.remove(wantedMedias, replacingMedia);
  }

  return wantedMedias;
}

export class SyncService {
  private static readonly logger = new Logger(SyncService.name);

  constructor(
    private traktClient: TraktApi,
    private config: Config,
  ) {
    configSchema.parse(config);
  }

  async listTargetMedias(users: UserAuthCtxt[]): Promise<WantedMedia[]> {
    return users.reduce(async (pWantedMedias: Promise<WantedMedia[]>, user: UserAuthCtxt): Promise<WantedMedia[]> => {
      const userWantedMedias = await this.listTargetMediasFor(user);
      return userWantedMedias.reduce(wantedMediaPusherFor(user), await pWantedMedias);
    }, Promise.resolve([]));
  }

  private async listTargetMediasFor(user: UserAuthCtxt): Promise<Media[]> {
    return [
      ...(await this.listProgressShows(user)),
      ...(await this.listWantedMedias(user)),
      ...(await this.listHighRatedMedias(user)),
      ...(await this.listListedMedias(user, 'Jellyfin')),
    ];
  }

  private async listHighRatedMedias(user: UserAuthCtxt): Promise<Media[]> {
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

  private async listWantedMedias(user: UserAuthCtxt): Promise<Media[]> {
    const listedMedias: ReleasedMedia[] = _.take(
      await this.traktClient.requestUserWatchlist(user, true),
      this.config.wantedLimit,
    );

    return this.expand(listedMedias, true);
  }

  private async listListedMedias(user: UserAuthCtxt, listName: string): Promise<Media[]> {
    const listedMedias: ReleasedMedia[] = _.take(await this.traktClient.requestUserList(user, listName), Infinity);

    return this.expand(listedMedias, false);
  }

  private async listProgressShows(user: UserAuthCtxt): Promise<Media[]> {
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

  async expand(medias: Media[], buffering: boolean = false): Promise<Media[]> {
    const movies = medias.filter((media) => media.type === 'movie');
    const shows = medias.filter((media) => media.type === 'show');
    const seasons = medias.filter((media) => media.type === 'season');
    const episodes = medias.filter((media) => media.type === 'episode');

    let expandedMedias: Promise<Media[]>[];
    if (buffering) {
      expandedMedias = [
        ...shows.map((s) => this.bufferedExpansion(s.show)),
        ...seasons.map((s) => this.bufferedExpansion(s.show, s.season.number)),
      ];
    } else {
      expandedMedias = [
        ...shows.map((s) => this.expandShow(s.show)),
        ...seasons.map((s) => this.expandSeason(s.show, s.season.number)),
      ];
    }

    return [...movies, ...episodes, ...(await Promise.all(expandedMedias)).flat()];
  }

  async expandShow(show: Show): Promise<Media[]> {
    const seasons = await this.traktClient.requestShowSeasonsDetails(show.ids.trakt);
    const episodes = seasons.flatMap((season) => (season.number > 0 ? season.episodes : []));

    // TODO Limit aired episodes
    return episodes.map((episode) => ({
      type: 'episode',
      show,
      episode,
    }));
  }

  async expandSeason(show: Show, seasonNumber: number): Promise<Media[]> {
    const seasons = await this.traktClient.requestShowSeasonsDetails(show.ids.trakt);
    const season = seasons.find((s) => s.number === seasonNumber);
    if (!season) {
      return [];
    }

    // TODO Limit aired episodes
    return season.episodes.map((episode) => ({
      type: 'episode',
      show,
      episode,
    }));
  }

  async bufferedExpansion(show: Show, startSeason: number = 1, startEpisode: number = 1): Promise<Media[]> {
    const showDetails = await this.traktClient.requestShowDetails(show.ids.trakt);
    const seasons = await this.traktClient.requestShowSeasonsDetails(show.ids.trakt);
    const count = showDetails.runtime ? Math.ceil(this.config.bufferDuration / showDetails.runtime) : 3;

    const episodes = seasons.flatMap((season) => (season.number > 0 ? season.episodes : []));
    const episodeIndex = episodes.findIndex(
      (episode) => episode.season === startSeason && episode.number === startEpisode,
    );

    // TODO Limit aired episodes
    return episodes.slice(episodeIndex, episodeIndex + count).map((episode) => ({
      type: 'episode',
      show,
      episode,
    }));
  }
}
