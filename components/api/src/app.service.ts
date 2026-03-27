import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { AxiosError } from 'axios';
import { CronJob } from 'cron';

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
import { StatusCheckService } from '@/services/status-checks';
import { SyncService } from '@/services/sync';

import { ClickUpAdminMessaging } from './services/messaging/admin/clickup';

@Injectable()
export class AppService implements OnModuleInit, OnModuleDestroy {
  private static readonly logger: Logger = new Logger(AppService.name);

  private listeners: Listener[] = [];

  private isRunning = false;

  private pendingEvents = new Set<Promise<unknown>>();

  constructor(
    readonly config: ConfigService<Config, true>,
    private readonly schedulerRegistry: SchedulerRegistry,
    private readonly sync: SyncService,
    private readonly jellyfin: JellyfinMediaService,
    private readonly messaging: AllUserMessaging,
    private readonly adminsMessaging: DiscordAdminMessaging,
    private readonly requestsTicketings: ClickUpAdminMessaging,
    private readonly usersRepository: UsersRepository, // TODO get user in event instead of fetching from db
    private readonly requestsRepository: RequestsRepository,
    private readonly statusChecks: StatusCheckService,
  ) {}

  onModuleInit(): void {
    this.listeners.push(this.listenDatabaseEvents(), this.listenAdminMessages());

    if (process.env.NODE_ENV === 'production') {
      this.registerCronJob('trakt-sync', '*/5 * * * *', () => this.runSync());
      this.registerCronJob('darkiworld-check', '0 * * * *', () => this.statusChecks.checkDarkiworldAvailability());
      this.registerCronJob('jellyfin-check', '*/15 * * * *', () => this.statusChecks.checkJellyfinFulfillment());
      this.registerCronJob('clickup-rejection-check', '*/15 * * * *', () => this.statusChecks.checkClickUpRejections());
    }
  }

  async onModuleDestroy(): Promise<void> {
    for (const [key, job] of this.schedulerRegistry.getCronJobs()) {
      job.stop();
      this.schedulerRegistry.deleteCronJob(key);
    }

    for (const listener of this.listeners) {
      listener.cleanup();
    }

    while (this.pendingEvents.size > 0) {
      AppService.logger.log(`Waiting for ${this.pendingEvents.size} pending events to complete...`);
      await Promise.allSettled(Array.from(this.pendingEvents));
    }
  }

  private async runSync(): Promise<void> {
    if (this.isRunning) {
      AppService.logger.warn('Sync already in progress, skipping');
      return;
    }

    this.isRunning = true;
    try {
      await this.sync.start();
    } catch (error) {
      AppService.logger.error(`Sync failed: ${error instanceof Error ? error.message : error}`);
      if (error instanceof Error && error.stack) {
        AppService.logger.debug(error.stack);
      }
    } finally {
      this.isRunning = false;
    }
  }

  private listenDatabaseEvents(): Listener<RequestEvents> {
    return this.requestsRepository.listen({
      created: (event: RequestCreatedEvent) =>
        this.trackEvent(async () => {
          const request = await this.requestsRepository.get(event.requestId);
          if (
            !request ||
            request.taskId ||
            request.status === RequestStatus.Fulfilled ||
            request.status === RequestStatus.Missing
          ) {
            return;
          }

          await this.requestsTicketings.register(request);
        }),
      statusChange: (event: RequestStatusChangedEvent) =>
        this.trackEvent(async () => {
          AppService.logger.log(`Status change event: ${event.requestId} (${event.oldStatus} → ${event.newStatus})`);
          const request = await this.requestsRepository.get(event.requestId);
          if (!request) {
            AppService.logger.warn(`Request ${event.requestId} not found for status change event`);
            return;
          }

          await this.requestsTicketings.updateMediaStatus(request);

          const userIds = request.userRequests?.map((user) => user.userId) ?? [];
          AppService.logger.log(`Notifying ${userIds.length} users for request ${event.requestId}`);
          for (const userId of userIds) {
            const user = await this.usersRepository.get(userId);
            if (user) {
              AppService.logger.debug(
                `Sending notification to user ${user.name} (${user.messagingKey}:${user.messagingId})`,
              );
              const userCtxt = { key: user.messagingKey, id: user.messagingId };
              await this.messaging.requestUpdated(userCtxt, request);
            } else {
              AppService.logger.warn(`User ${userId} not found for notification`);
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

          if (request.userRequests?.length === 0 && request.status !== RequestStatus.Rejected) {
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
        const existingJellyfinUser = await this.jellyfin.findUserByName(user.name);
        if (existingJellyfinUser) {
          user.jellyfinId = existingJellyfinUser.Id;
          await this.jellyfin.resetUserPassword(user.jellyfinId, password);
        } else {
          user.jellyfinId = await this.jellyfin.registerUser(user.name, password);
        }
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

  private registerCronJob(name: string, cronExpression: string, handler: () => Promise<void>): void {
    const job = new CronJob(cronExpression, async () => {
      try {
        await handler();
      } catch (error) {
        AppService.logger.error(`Job "${name}" failed: ${error instanceof Error ? error.message : error}`);
      }
    });
    this.schedulerRegistry.addCronJob(name, job);
    job.start();
  }

  private trackEvent<T>(eventHandler: () => Promise<T>): Promise<T> {
    const eventPromise = eventHandler();
    eventPromise.finally(() => this.pendingEvents.delete(eventPromise));
    this.pendingEvents.add(eventPromise);
    return eventPromise;
  }
}
