import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AxiosError } from 'axios';

import { Config } from '@/app.module';
import { Listener } from '@/helpers/events';
import { JellyfinMediaService } from '@/modules/jellyfin/jellyfin';
import {
  RequestCreatedEvent,
  RequestEvents,
  RequestsRepository,
  RequestStatus,
  RequestStatusChangedEvent,
  UserJoinedRequestEvent,
  UserLeftRequestEvent,
} from '@/services/database/requests';
import { UserEntity, UsersRepository } from '@/services/database/users';
import {
  AdminEvents,
  AdminUserAcceptedEvent,
  AdminUserRejectedEvent,
  DiscordAdminMessaging,
} from '@/services/messaging/admin/discord';
import { AllUserMessaging } from '@/services/messaging/user/all';
import { SyncService } from '@/services/sync';

import { ClickUpAdminMessaging } from './services/messaging/admin/clickup';

@Injectable()
export class AppService implements OnModuleInit, OnModuleDestroy {
  private static readonly logger: Logger = new Logger(AppService.name);

  private nextSyncTimeout?: NodeJS.Timeout;

  private listeners: Listener[] = [];

  private syncInterval: number;

  private pendingEvents = new Set<Promise<unknown>>();

  constructor(
    readonly config: ConfigService<Config, true>,
    private readonly sync: SyncService,
    private readonly jellyfin: JellyfinMediaService,
    private readonly messaging: AllUserMessaging,
    private readonly adminsMessaging: DiscordAdminMessaging,
    private readonly requestsTicketings: ClickUpAdminMessaging,
    private readonly usersRepository: UsersRepository, // TODO get user in event instead of fetching from db
    private readonly requestsRepository: RequestsRepository,
  ) {
    this.syncInterval = this.config.get<number>('syncInterval_ms');
  }

  onModuleInit(): void {
    this.listeners.push(this.listenDatabaseEvents(), this.listenAdminMessages());

    this.sync.start().then(() => this.scheduleNextSync());
  }

  async onModuleDestroy(): Promise<void> {
    clearTimeout(this.nextSyncTimeout);

    for (const listener of this.listeners) {
      listener.cleanup();
    }

    while (this.pendingEvents.size > 0) {
      AppService.logger.log(`Waiting for ${this.pendingEvents.size} pending events to complete...`);
      await Promise.allSettled(Array.from(this.pendingEvents));
    }
  }

  private scheduleNextSync(): void {
    if (process.argv.includes('--once')) {
      process.emit('SIGINT');
      return;
    }

    this.nextSyncTimeout = setTimeout(() => {
      this.sync.start().then(() => this.scheduleNextSync());
    }, this.syncInterval);
  }

  private listenDatabaseEvents(): Listener<RequestEvents> {
    return this.requestsRepository.listen({
      created: (event: RequestCreatedEvent) =>
        this.trackEvent(async () => {
          const request = await this.requestsRepository.get(event.requestId);
          if (!request || request.taskId || request.status === RequestStatus.Fulfilled) {
            return;
          }

          await this.requestsTicketings.register(request);
        }),
      statusChange: (event: RequestStatusChangedEvent) =>
        this.trackEvent(async () => {
          const request = await this.requestsRepository.get(event.requestId);
          if (!request) {
            return;
          }

          await this.requestsTicketings.updateMediaStatus(request);

          // Send user notifications
          for (const userId of request.userRequests?.map((user) => user.userId) ?? []) {
            const user = await this.usersRepository.get(userId);
            if (user) {
              const userCtxt = { key: user.messagingKey, id: user.messagingId };
              await this.messaging.requestUpdated(userCtxt, request);
            }
          }
        }),
      userJoined: (event: UserJoinedRequestEvent) =>
        this.trackEvent(async () => {
          const user = await this.usersRepository.get(event.userId);
          const request = await this.requestsRepository.get(event.requestId);
          if (!request || !user) {
            return;
          }

          await this.messaging.requestUpdated({ key: user.messagingKey, id: user.messagingId }, request);
        }),
      userLeft: (event: UserLeftRequestEvent) =>
        this.trackEvent(async () => {
          const request = await this.requestsRepository.get(event.requestId);
          if (!request) {
            return;
          }

          if (request.userRequests?.length === 0) {
            await this.requestsTicketings.deleteTask(request);
            await this.requestsRepository.removeRequest(request.mediaId);
          }
        }),
    });
  }

  private listenAdminMessages(): Listener<AdminEvents> {
    return this.adminsMessaging.listen({
      userAccepted: ({ user }: AdminUserAcceptedEvent) => this.trackEvent(() => this.onUserAccepted(user)),
      userRejected: ({ user }: AdminUserRejectedEvent) => this.trackEvent(() => this.onUserRejected(user)),
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

  private trackEvent<T>(eventHandler: () => Promise<T>): Promise<T> {
    const eventPromise = eventHandler();
    eventPromise.finally(() => this.pendingEvents.delete(eventPromise));
    this.pendingEvents.add(eventPromise);
    return eventPromise;
  }
}
