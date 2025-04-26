import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { AxiosError } from 'axios';

import { Listener } from '@/helpers/events';
import { JellyfinMediaService } from '@/modules/jellyfin/jellyfin';
import {
  RequestCreatedEvent,
  RequestEvents,
  RequestsRepository,
  RequestStatusChangedEvent,
  UserJoinedRequestEvent,
  UserLeftRequestEvent,
} from '@/services/database/requests';
import { UserEntity, UsersRepository } from '@/services/database/users';
import {
  AdminMediaRequestStatusChangeEvent,
  AdminUserAcceptedEvent,
  AdminUserRejectedEvent,
  DiscordAdminMessaging,
  AdminEvents,
} from '@/services/messaging/admin/discord';
import { AllUserMessaging } from '@/services/messaging/user/all';
import { SyncService } from '@/services/sync';
import { ConfigService } from '@nestjs/config';
import { Config } from '@/app.module';

@Injectable()
export class AppService implements OnModuleInit, OnModuleDestroy {
  private static readonly logger: Logger = new Logger(AppService.name);

  private nextSyncTimeout?: NodeJS.Timeout;

  private listeners: Listener[] = [];

  private syncInterval: number;

  constructor(
    readonly config: ConfigService<Config, true>,
    private readonly sync: SyncService,
    private readonly jellyfin: JellyfinMediaService,
    private readonly messaging: AllUserMessaging,
    private readonly adminsMessaging: DiscordAdminMessaging,
    private readonly usersRepository: UsersRepository, // TODO get user in event instead of fetching from db
    private readonly requestsRepository: RequestsRepository,
  ) {
    this.syncInterval = this.config.get<number>('syncInterval_ms');
  }

  onModuleInit(): void {
    this.listeners.push(this.listenDatabaseEvents(), this.listenAdminMessages());

    this.sync.start().then(() => this.scheduleNextSync());
  }

  onModuleDestroy(): void {
    clearTimeout(this.nextSyncTimeout);
    for (const listener of this.listeners) {
      listener.cleanup();
    }
  }

  private scheduleNextSync(): void {
    clearTimeout(this.nextSyncTimeout);
    this.nextSyncTimeout = setTimeout(() => {
      this.sync.start().then(() => this.scheduleNextSync());
    }, this.syncInterval);
  }

  private listenDatabaseEvents(): Listener<RequestEvents> {
    return this.requestsRepository.listen({
      created: async (event: RequestCreatedEvent) => {
        const request = await this.requestsRepository.get(event.requestId);
        if (!request) {
          return;
        }

        await this.adminsMessaging.newMediaRequest(request);
      },
      statusChange: async (event: RequestStatusChangedEvent) => {
        const request = await this.requestsRepository.get(event.requestId);
        if (!request) {
          return;
        }

        await this.adminsMessaging.updateMediaStatus(request);
        for (const userId of request.userRequests?.map((user) => user.userId) ?? []) {
          const user = await this.usersRepository.get(userId);
          if (user) {
            const userCtxt = { key: user.messagingKey, id: user.messagingId };
            this.messaging.requestUpdated(userCtxt, request);
          }
        }
      },
      userJoined: async (event: UserJoinedRequestEvent) => {
        const user = await this.usersRepository.get(event.userId);
        const request = await this.requestsRepository.get(event.requestId);
        if (!request || !user) {
          return;
        }

        if (request.userRequests?.length !== 1) {
          // FIXME Missing user names
          await this.adminsMessaging.updateMediaStatus(request);
          await this.messaging.requestUpdated({ key: user.messagingKey, id: user.messagingId }, request);
        } else if (request.status === 'canceled') {
          await this.requestsRepository.updateStatus(request.mediaId, 'pending');
        }
      },
      userLeft: async (event: UserLeftRequestEvent) => {
        const request = await this.requestsRepository.get(event.requestId);
        if (!request) {
          return;
        }

        if (request.userRequests?.length !== 0) {
          // FIXME Missing user names
          await this.adminsMessaging.updateMediaStatus(request);
        } else if (request.status === 'pending' || request.status === 'fulfilled') {
          await this.requestsRepository.updateStatus(request.mediaId, 'canceled');
        }
      },
    });
  }

  private listenAdminMessages(): Listener<AdminEvents> {
    return this.adminsMessaging.listen({
      mediaRequestStatusChange: async ({ request, status }: AdminMediaRequestStatusChangeEvent) => {
        AppService.logger.log(`Updating status of media request ${request.mediaId} to ${status}`);
        await this.requestsRepository.updateStatus(request.mediaId, status);
      },
      userAccepted: async ({ user }: AdminUserAcceptedEvent) => this.onUserAccepted(user),
      userRejected: async ({ user }: AdminUserRejectedEvent) => this.onUserRejected(user),
    });
  }

  private async onUserAccepted(user: UserEntity): Promise<void> {
    const messagingContext = { key: user.messagingKey, id: user.messagingId };
    const password = Math.random().toString(36).substring(2, 15);

    try {
      if (user.jellyfinId) {
        await this.jellyfin.resetUserPassword(user.jellyfinId, password);
      } else {
        user.jellyfinId = await this.jellyfin.registerUser(user.name, password);
        await this.usersRepository.setJellyfinId(user.id, user.jellyfinId);
      }

      this.messaging.registered(messagingContext, user, password);
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
    this.messaging.error(messagingContext, 'Votre inscription a été refusée');
  }
}
