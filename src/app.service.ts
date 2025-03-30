import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { AxiosError } from 'axios';

import { Listener } from '@/helpers/events';
import { JellyfinMediaService, JellyfinUser } from '@/modules/jellyfin/jellyfin';
import { TraktPlugin } from '@/modules/jellyfin/plugins/trakt';
import { TraktApi } from '@/modules/trakt/TraktApi';
import { MediaRequestsRepository, MediaRequestStatusChangedEvent } from '@/services/database/mediaRequests';
import { UserEntity, UsersRepository } from '@/services/database/users';
import {
  AdminMediaRequestStatusChangeEvent,
  AdminUserAcceptedEvent,
  AdminUserRejectedEvent,
  DiscordAdminMessaging,
} from '@/services/messaging/admin/discord';
import { AllUserMessaging, UserMessagingCtxt } from '@/services/messaging/user/all';
import { SyncService } from '@/services/sync';

type UserWithAuthContext = UserEntity & {
  accessToken: string;
};

@Injectable()
export class AppService implements OnModuleInit, OnModuleDestroy {
  private static readonly logger: Logger = new Logger(AppService.name);

  private processSyncInterval?: NodeJS.Timeout;

  private listeners: Listener[] = [];

  constructor(
    private readonly sync: SyncService,
    private readonly jellyfin: JellyfinMediaService,
    private readonly traktPlugin: TraktPlugin,
    private readonly mediaRequestsDB: MediaRequestsRepository,
    private readonly usersDB: UsersRepository,
    private readonly messaging: AllUserMessaging,
    private readonly adminsMessaging: DiscordAdminMessaging,
    private readonly trakt: TraktApi,
  ) {}

  async onModuleInit(): Promise<void> {
    this.listeners.push(
      this.mediaRequestsDB.listen({
        statusChange: async (event: MediaRequestStatusChangedEvent) => {
          const request = (await this.mediaRequestsDB.get(event.requestId))!;

          await this.adminsMessaging.updateMediaStatus(request);
          for (const userId of request.userIds) {
            const user = await this.usersDB.get(userId);
            if (user) {
              const userCtxt = { key: user.messagingKey, id: user.messagingId };
              this.messaging.mediaRequestUpdated(userCtxt, request);
            }
          }
        },
      }),
    );

    this.listeners.push(
      this.adminsMessaging.listen({
        mediaRequestStatusChange: async ({ request, status }: AdminMediaRequestStatusChangeEvent) => {
          AppService.logger.log(`Updating status of media request ${request.id} to ${status}`);
          await this.mediaRequestsDB.updateStatus(request.id, status);
        },
        userAccepted: async ({ user }: AdminUserAcceptedEvent) => this.onUserAccepted(user),
        userRejected: async ({ user }: AdminUserRejectedEvent) => this.onUserRejected(user),
      }),
    );

    // await this.processSync();
    // this.processSyncInterval = setInterval(async () => await this.processSync(), 1000 * 60 * 60);
  }

  async onModuleDestroy(): Promise<void> {
    clearInterval(this.processSyncInterval);
    for (const listener of this.listeners) {
      listener.cleanup();
    }
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
    await this.importCollectedMedias();

    AppService.logger.log('Synchronization completed');
  }

  private async importTargetedMedias(users: UserWithAuthContext[]): Promise<void> {
    const userById = users.reduce(
      (acc, user) => ({ ...acc, [user.id]: user }),
      {} as Record<string, UserWithAuthContext>,
    );
    const targetMedias = await this.sync.listTargetMedias(users);
    AppService.logger.log(`Targeting ${targetMedias.length} medias.`);

    const { inserted, joinByUser } = await this.mediaRequestsDB.syncTargeted(targetMedias);

    AppService.logger.log(`Inserting ${inserted.length} requests.`);
    for (const request of inserted) {
      request.users = request.userIds.map((id) => userById[id]);
      await this.adminsMessaging.newMediaRequest(request);
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

  private async importCollectedMedias(): Promise<void> {
    const collectedMedias = await this.jellyfin.listMedias();
    AppService.logger.log(`Collecting ${collectedMedias.length} medias.`);

    const { fulfilled } = await this.mediaRequestsDB.syncCollected(collectedMedias);
    AppService.logger.log(`Updating ${fulfilled.length} requests.`);
  }

  private async onUserAccepted(user: UserEntity): Promise<void> {
    const password = Math.random().toString(36).substring(2, 15);

    const messagingContext = { key: user.messagingKey, id: user.messagingId };

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
          id: await this.jellyfin.registerUser(user.name, password),
          name: user.name,
          password,
        };
        user.jellyfinId = jellyfinUser.id;
        await this.usersDB.upsert(user);
      }

      this.messaging.registered(messagingContext, jellyfinUser);
    } catch (error) {
      if (error instanceof Error && error.message === 'User already exists') {
        this.messaging.error(messagingContext, "Ce nom d'utilisateur existe déjà merci d'en choisir un autre");
      } else {
        const message = error instanceof AxiosError ? error.response?.data : error;
        AppService.logger.error(`Error registering user ${user.name}: ${message}`);
        this.messaging.error(messagingContext, "Erreur lors de l'inscription");
      }
    }
  }

  private async onUserRejected(user: UserEntity): Promise<void> {
    const messagingContext = { key: user.messagingKey, id: user.messagingId };
    this.messaging.error(messagingContext, "Votre inscription a été refusée");
  }
}
