import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { AxiosError } from 'axios';

import { JellyfinMediaService, JellyfinUser } from '@/modules/jellyfin/jellyfin';
import { TraktPlugin } from '@/modules/jellyfin/plugins/trakt';
import { TraktApi } from '@/modules/trakt/TraktApi';
import { MediaRequestRepository } from '@/services/database/mediaRequests';
import { UserEntity, UsersRepository } from '@/services/database/users';
import { DiscordAdminMessaging } from '@/services/messaging/admin/discord';
import { AllUserMessaging, UserMessagingCtxt } from '@/services/messaging/user/all';
import { SyncService } from '@/services/sync';

type UserWithAuthContext = UserEntity & {
  accessToken: string;
};

@Injectable()
export class AppService implements OnModuleInit, OnModuleDestroy {
  private static readonly logger: Logger = new Logger(AppService.name);

  private processSyncInterval?: NodeJS.Timeout;

  constructor(
    private readonly sync: SyncService,
    private readonly jellyfin: JellyfinMediaService,
    private readonly traktPlugin: TraktPlugin,
    private readonly mediaRequestsDB: MediaRequestRepository,
    private readonly usersDB: UsersRepository,
    private readonly messaging: AllUserMessaging,
    private readonly adminsMessaging: DiscordAdminMessaging,
    private readonly trakt: TraktApi,
  ) {}

  async onModuleInit(): Promise<void> {
    this.messaging.onJoin(this.handleJoin.bind(this));
    this.messaging.onRegisterRequest(this.handleRequestRegister.bind(this));
    this.messaging.onTraktLinkRequest(this.handleRequestTraktLink.bind(this));
    AppService.logger.log('Messaging listeners initialized');

    await this.processSync();
    this.processSyncInterval = setInterval(async () => await this.processSync(), 1000 * 60);
  }

  async onModuleDestroy(): Promise<void> {
    clearInterval(this.processSyncInterval);
  }

  private async processSync() {
    AppService.logger.log('Starting synchronization');

    const authContexts = await this.traktPlugin.getUsersAuthContext();

    const users = await this.usersDB.list();
    const usersWithAuthContext = authContexts
      .map(
        (authContext): UserWithAuthContext => ({
          ...authContext,
          ...users.find((user) => user.jellyfinId === authContext.jellyfinId)!,
        }),
      )
      .filter((user) => user.id);

    await this.importTargetedMedias(usersWithAuthContext);
    await this.importCollectedMedias(usersWithAuthContext);

    AppService.logger.log('Synchronization completed');
  }

  private async importTargetedMedias(users: UserWithAuthContext[]): Promise<void> {
    const userById = users.reduce(
      (acc, user) => ({ ...acc, [user.id]: user }),
      {} as Record<string, UserWithAuthContext>,
    );
    const targetMedias = await this.sync.listTargetMedias(users);
    AppService.logger.log(`Targeting ${targetMedias.length} medias.`);

    const { inserted, canceled, joinByUser } = await this.mediaRequestsDB.syncTargeted(targetMedias);

    AppService.logger.log(`Inserting ${inserted.length} requests.`);
    for (const request of inserted) {
      request.users = request.userIds.map((id) => userById[id]);
      const { threadId } = await this.adminsMessaging.newMediaRequest(request);
      await this.mediaRequestsDB.attachThread(request, threadId);
    }

    AppService.logger.log(`Cancelling ${canceled.length} requests.`);
    for (const request of canceled) {
      await this.adminsMessaging.updateMediaStatus(request);
    }

    // TODO notify admin of new join ?
    for (const [userId, requests] of Object.entries(joinByUser)) {
      const user = users.find((user) => user.id === userId);
      if (!user) {
        AppService.logger.warn(`User ${userId} not found`);
        continue;
      }
      AppService.logger.log(`Notifying user ${user.name} of ${requests.length} requests.`);
      const userCtxt = { key: user.messagingKey, id: user.messagingId };
      for (const request of requests) {
        this.messaging.mediaRequestUpdated(userCtxt, request);
      }
    }
  }

  private async importCollectedMedias(users: UserWithAuthContext[]): Promise<void> {
    const collectedMedias = await this.jellyfin.listMedias();
    AppService.logger.log(`Collecting ${collectedMedias.length} medias.`);

    const { fulfilled } = await this.mediaRequestsDB.syncCollected(collectedMedias);
    AppService.logger.log(`Updating ${fulfilled.length} requests.`);
    for (const request of fulfilled) {
      this.adminsMessaging.updateMediaStatus(request);

      for (const userId of request.userIds) {
        const user = users.find((user) => user.id === userId);
        if (!user) {
          AppService.logger.warn(`User ${userId} not found`);
          continue;
        }
        const userCtxt = { key: user.messagingKey, id: user.messagingId };
        this.messaging.mediaRequestUpdated(userCtxt, request);
      }
    }
  }

  private async handleJoin(ctxt: UserMessagingCtxt): Promise<UserEntity> {
    const user =
      (await this.usersDB.getByMessaging(ctxt)) ||
      (await this.usersDB.upsert({
        messagingKey: ctxt.key,
        messagingId: ctxt.id,
        jellyfinId: null,
        name: '',
      }));
    this.messaging.welcome(ctxt);
    return user;
  }

  private async handleRequestRegister(ctxt: UserMessagingCtxt, username: string): Promise<void> {
    const user = (await this.usersDB.getByMessaging(ctxt)) || (await this.handleJoin(ctxt));
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
        this.messaging.error(ctxt, "Ce nom d'utilisateur existe déjà merci d'en choisir un autre");
      } else {
        const message = error instanceof AxiosError ? error.response?.data : error;
        AppService.logger.error(`Error registering user ${username}: ${message}`);
        this.messaging.error(ctxt, "Erreur lors de l'inscription");
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
