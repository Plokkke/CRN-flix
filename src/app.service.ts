import { Injectable, Logger, OnModuleInit } from '@nestjs/common';

import { JellyfinMedia, JellyfinMediaService, JellyfinUser } from '@/modules/jellyfin/jellyfin';
import { TraktPlugin } from '@/modules/jellyfin/plugins/trakt';
import { Media, WantedMedia } from '@/modules/trakt/types';
import { SyncService } from '@/services/sync';

import { TraktApi } from './modules/trakt/TraktApi';
import { MediaRequestEntity, MediaRequestRepository } from './services/database/mediaRequests';
import { UserEntity, UsersRepository } from './services/database/users';
import { AllUserMessaging, UserMessagingCtxt } from './services/messaging/user/all';
import { AxiosError } from 'axios';
import { log } from 'console';

function imdbId(media: Media): string {
  switch (media.type) {
    case 'movie':
      return media.movie.ids.imdb ?? '';
    case 'show':
      return media.show.ids.imdb ?? '';
    case 'season':
      return media.season.ids.imdb ?? '';
    case 'episode':
      return media.episode.ids.imdb ?? '';
  }
}

function mediaInfos(media: Media): {
  type: 'movie' | 'show' | 'season' | 'episode';
  title: string;
  year: number | null;
  imdbId: string;
  seasonNumber: number | null;
  episodeNumber: number | null;
} {
  switch (media.type) {
    case 'movie':
      return {
        type: 'movie',
        title: media.movie.title,
        year: media.movie.year,
        imdbId: media.movie.ids.imdb ?? '',
        seasonNumber: null,
        episodeNumber: null,
      };
    case 'show':
      return {
        type: 'show',
        title: media.show.title,
        year: media.show.year,
        imdbId: media.show.ids.imdb ?? '',
        seasonNumber: null,
        episodeNumber: null,
      };
    case 'season':
      return {
        type: 'season',
        title: media.show.title,
        year: media.show.year,
        imdbId: media.show.ids.imdb ?? '',
        seasonNumber: media.season.number,
        episodeNumber: null,
      };
    case 'episode':
      return {
        type: 'episode',
        title: media.show.title,
        year: media.show.year,
        imdbId: media.show.ids.imdb ?? '',
        seasonNumber: media.episode.season,
        episodeNumber: media.episode.number,
      };
  }
}

type UserWithAuthContext = UserEntity & {
  accessToken: string;
};

@Injectable()
export class AppService implements OnModuleInit {
  private static readonly logger: Logger = new Logger(AppService.name);

  constructor(
    private readonly sync: SyncService,
    private readonly jellyfin: JellyfinMediaService,
    private readonly traktPlugin: TraktPlugin,
    private readonly mediaRequestsDB: MediaRequestRepository,
    private readonly usersDB: UsersRepository,
    private readonly messaging: AllUserMessaging,
    private readonly trakt: TraktApi,
  ) {}

  async onModuleInit(): Promise<void> {
    this.messaging.onJoin(this.handleJoin.bind(this));
    this.messaging.onRegisterRequest(this.handleRequestRegister.bind(this));
    this.messaging.onTraktLinkRequest(this.handleRequestTraktLink.bind(this));

    await this.processSync();
  }

  private async processSync() {
    const authContexts = await this.traktPlugin.getUsersAuthContext();
    const users = await this.usersDB.list();
    const usersWithAuthContext = authContexts.map(
      (authContext): UserWithAuthContext => ({
        ...authContext,
        ...users.find((user) => user.jellyfinId === authContext.jellyfinId)!,
      })
    ).filter((user) => user.id);

    const [missingMedias] = await this.computeDelta(usersWithAuthContext);
    const requests = await this.mediaRequestsDB.list();
    const requestsByImdbId = requests.reduce((acc, request) => {
      acc[request.imdbId] = request;
      return acc;
    }, {} as Record<string, MediaRequestEntity>);

    for (const missingMedia of missingMedias) {
      const missingMediaInfos = mediaInfos(missingMedia.media);
      const requestMedia = requestsByImdbId[missingMediaInfos.imdbId];
      if (!requestMedia) {
        // TODO notify admins
        // TODO notify requesters
        await this.mediaRequestsDB.upsert({
          status: 'missing',
          ...missingMediaInfos,
          userIds: missingMedia.userIds,
          threadId: null,
        });
      } else {
        delete requestsByImdbId[missingMediaInfos.imdbId];
        const newRequesterIds = missingMedia.userIds.filter((userId) => !requestMedia.userIds.includes(userId));
        // TODO notify new requesters
        // TODO insert new requesters
      }
    }

    // Not missing anymore
    for (const request of Object.values(requestsByImdbId)) {
      // TODO notify admins
      // TODO notify requesters
      // Drop media request
    }
  }

  private async computeDelta(users: UserWithAuthContext[]): Promise<[WantedMedia[], JellyfinMedia[]]> {
    const targetMedias = await this.sync.listTargetMedias(users);
    AppService.logger.log(`Targeting ${targetMedias.length} medias.`);

    const collectedMedias = await this.jellyfin.listMedias();
    AppService.logger.log(`Collected ${collectedMedias.length} medias.`);

    const jellyfinMediaByImdbId = new Map<string, JellyfinMedia>(
      collectedMedias
        .filter((media) => Boolean(media.ProviderIds.Imdb))
        .map((media) => [media.ProviderIds.Imdb!, media]),
    );

    const missingMedias = targetMedias.filter((media) => !jellyfinMediaByImdbId.has(imdbId(media.media)));
    AppService.logger.log(`Missing ${missingMedias.length} medias.`);

    const overagedMedias = collectedMedias.filter(
      (media) => !targetMedias.some((m) => imdbId(m.media) === media.ProviderIds.Imdb),
    );
    AppService.logger.log(`Overaged ${overagedMedias.length} medias.`);

    return [missingMedias, overagedMedias];
  }

  private async handleJoin(ctxt: UserMessagingCtxt): Promise<UserEntity> {
    const user = await this.usersDB.getByMessaging(ctxt) || await this.usersDB.upsert({
      messagingKey: ctxt.key,
      messagingId: ctxt.id,
      jellyfinId: null,
      name: '',
    });
    this.messaging.welcome(ctxt);
    return user;
  }

  private async handleRequestRegister(ctxt: UserMessagingCtxt, username: string): Promise<void> {
    const user = await this.usersDB.getByMessaging(ctxt) || await this.handleJoin(ctxt);
    const password = Math.random().toString(36).substring(2, 15);

    try {
      let jellyfinUser: JellyfinUser;
      if (user.jellyfinId) {
        await this.jellyfin.resetUserPassword(user.jellyfinId, password);
        jellyfinUser = {
          id: user.jellyfinId,
          name: user.name,
          password,
        };
      } else {
        jellyfinUser = {
          id: await this.jellyfin.registerUser(username, password),
          name: username,
          password,
        };
        user.jellyfinId = jellyfinUser.id;
        user.name = username;
      }
      await this.usersDB.upsert(user);

      this.messaging.registered(ctxt, jellyfinUser);
    } catch (error) {
      if (error instanceof Error && error.message === 'User already exists') {
        this.messaging.error(ctxt, 'Ce nom d\'utilisateur existe déjà merci d\'en choisir un autre');
      } else {
        const message = error instanceof AxiosError ? error.response?.data : error;
        AppService.logger.error(`Error registering user ${username}: ${message}`);
        this.messaging.error(ctxt, 'Erreur lors de l\'inscription');
      }
    }
  }

  private async handleRequestTraktLink(ctxt: UserMessagingCtxt): Promise<void> {
    const user = await this.usersDB.getByMessaging(ctxt);
    if (!user) {
      throw new Error('User not found');
    }
    if (!user.jellyfinId) {
      throw new Error('User not registered to Jellyfin');
    }

    const authCtxt = await this.trakt
      .authorizeDevice(async (authDeviceCtxt) => this.messaging.traktLinkRequest(ctxt, authDeviceCtxt))
      .catch(() => null);

    if (authCtxt) {
      await this.traktPlugin.setConfig(user.jellyfinId, authCtxt.accessToken);
    }
  }
}
