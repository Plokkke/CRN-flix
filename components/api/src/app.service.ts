import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { AxiosError } from 'axios';
import { CronJob } from 'cron';

import { Config } from '@/app.module';
import { Listener } from '@/helpers/events';
import { JellyfinMediaService } from '@/modules/jellyfin/jellyfin';
import { DarkiworldSyncService } from '@/services/darkiworld-sync';
import {
  DownloadJobEvents,
  DownloadJobsRepository,
  DownloadJobStatus,
  DownloadJobStatusChangedEvent,
} from '@/services/database/download-jobs';
import { MediasRepository } from '@/services/database/medias';
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
import { FetchrSyncService } from '@/services/fetchr-sync';
import { JellyfinSyncService } from '@/services/jellyfin-sync';
import {
  AdminEventMap,
  AdminEventType,
  AdminIdentificationRetryEvent,
  AdminImdbResolveEvent,
  DiscordAdminMessaging,
} from '@/services/messaging/admin/discord';
import { AllUserMessaging } from '@/services/messaging/user/all';
import { PostDownloadPipeline } from '@/services/post-download-pipeline';
import { TraktSyncService } from '@/services/trakt-sync';

import { DiscordSyncService } from './services/discord-sync';

@Injectable()
export class AppService implements OnModuleInit, OnModuleDestroy {
  private static readonly logger: Logger = new Logger(AppService.name);

  private listeners: Listener[] = [];

  private isRunning = false;

  private pendingEvents = new Set<Promise<unknown>>();

  constructor(
    readonly config: ConfigService<Config, true>,
    private readonly schedulerRegistry: SchedulerRegistry,
    private readonly traktSync: TraktSyncService,
    private readonly jellyfinSync: JellyfinSyncService,
    private readonly darkiworldSync: DarkiworldSyncService,
    private readonly discordSync: DiscordSyncService,
    private readonly jellyfin: JellyfinMediaService,
    private readonly messaging: AllUserMessaging,
    private readonly adminsMessaging: DiscordAdminMessaging,
    private readonly usersRepository: UsersRepository,
    private readonly requestsRepository: RequestsRepository,
    private readonly mediasRepository: MediasRepository,
    private readonly fetchrSync: FetchrSyncService,
    private readonly postDownloadPipeline: PostDownloadPipeline,
    private readonly downloadJobs: DownloadJobsRepository,
  ) {}

  onModuleInit(): void {
    this.listeners.push(this.listenRequestsEvents(), this.listenAdminMessages(), this.listenDownloadJobEvents());

    if (process.env.NODE_ENV === 'production') {
      this.registerCronJob('trakt-sync-job', '*/5 * * * *', () => this.runSync());
      this.registerCronJob('darkiworld-sync-job', '0 * * * *', () => this.darkiworldSync.sync());
      this.registerCronJob('jellyfin-sync-job', '*/15 * * * *', () => this.jellyfinSync.sync());
      this.registerCronJob('discord-sync-job', '*/5 * * * *', () => this.discordSync.sync());
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
      await this.traktSync.sync();
    } catch (error) {
      AppService.logger.error(`Sync failed: ${error instanceof Error ? error.message : error}`);
      if (error instanceof Error && error.stack) {
        AppService.logger.debug(error.stack);
      }
    } finally {
      this.isRunning = false;
    }
  }

  private listenRequestsEvents(): Listener<RequestEvents> {
    return this.requestsRepository.listen({
      created: (event: RequestCreatedEvent) =>
        this.trackEvent(async () => {
          const request = await this.requestsRepository.get(event.requestId);
          if (
            !request ||
            request.discordMessageId ||
            request.status === RequestStatus.Fulfilled ||
            request.status === RequestStatus.Missing
          ) {
            return;
          }

          if (request.media && !request.media.imdbId) {
            await this.adminsMessaging.notifyMissingImdbId(request);
            return;
          }

          await this.adminsMessaging.registerRequest(request);
        }),
      statusChange: (event: RequestStatusChangedEvent) =>
        this.trackEvent(async () => {
          AppService.logger.log(`Status change event: ${event.requestId} (${event.oldStatus} → ${event.newStatus})`);
          const request = await this.requestsRepository.get(event.requestId);
          if (!request) {
            AppService.logger.warn(`Request ${event.requestId} not found for status change event`);
            return;
          }

          await this.adminsMessaging.updateRequestStatus(request);

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

          const deletableStatuses = [RequestStatus.Missing, RequestStatus.Pending];
          if (request.userRequests?.length === 0 && deletableStatuses.includes(request.status)) {
            await this.adminsMessaging.deleteRequestMessage(request);
            await this.requestsRepository.removeRequest(request.mediaId);
          }
        }),
    });
  }

  private listenDownloadJobEvents(): Listener<DownloadJobEvents> {
    return this.downloadJobs.listen({
      created: ({ jobId }) =>
        this.trackEvent(async () => {
          AppService.logger.log(`New download job created: ${jobId}`);
          await this.postDownloadPipeline.processJob(jobId);
        }),
      statusChange: (event: DownloadJobStatusChangedEvent) =>
        this.trackEvent(async () => {
          const job = await this.downloadJobs.get(event.jobId);
          if (!job) {
            return;
          }

          if (event.newStatus === DownloadJobStatus.Failed) {
            AppService.logger.warn(`Download job ${event.jobId} failed: ${event.oldStatus} → ${event.newStatus}`);
            const failedFiles = job.sourcePaths.map((p) => p.split('/').pop()).filter(Boolean) as string[];
            const errorMessage = job.errorMessage ?? 'Unknown error';

            if (errorMessage.includes('Identification failed') || errorMessage.includes('Cannot identify')) {
              const messageId = await this.adminsMessaging.notifyIdentificationFailure(
                job.packageName || 'unknown',
                failedFiles.length > 0 ? failedFiles : [job.packageName || 'unknown'],
                errorMessage,
              );
              await this.downloadJobs.updateDiscordMessageId(event.jobId, messageId);
            } else {
              await this.adminsMessaging.notifyPipelineFailure(
                failedFiles.join(', ') || job.packageName || 'unknown',
                job.status.replace('_', ' '),
                errorMessage,
                null,
              );
            }
          } else if (event.newStatus === DownloadJobStatus.Completed) {
            AppService.logger.log(`Download job ${event.jobId} completed`);
            await this.jellyfin.refreshLibrary();
            await this.requestsRepository.fulfillByJobId(event.jobId);
            this.fetchrSync.remove(job.sourceId);
          }
        }),
    });
  }

  private listenAdminMessages(): Listener<AdminEventMap> {
    return this.adminsMessaging.listen({
      [AdminEventType.UserAccepted]: ({ user }) => this.trackEvent(() => this.onUserAccepted(user)),
      [AdminEventType.UserRejected]: ({ user }) => this.trackEvent(() => this.onUserRejected(user)),
      [AdminEventType.IdentificationRetry]: (event) => this.trackEvent(() => this.onIdentificationRetry(event)),
      [AdminEventType.ImdbResolve]: (event) => this.trackEvent(() => this.onImdbResolve(event)),
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

      await this.adminsMessaging.deleteUserMessage(user);
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
    await this.adminsMessaging.deleteUserMessage(user);
    await this.usersRepository.remove(user.id);
  }

  private async onIdentificationRetry({ job, imdbId, replyMessageId }: AdminIdentificationRetryEvent): Promise<void> {
    AppService.logger.log(`Retrying identification for job ${job.id} with IMDb ID ${imdbId}`);
    await this.postDownloadPipeline.retryWithImdbId(job.id, imdbId);

    const updatedJob = await this.downloadJobs.get(job.id);
    const emoji = updatedJob?.status === DownloadJobStatus.Completed ? '✅' : '❌';
    await this.adminsMessaging.reactToMessage(replyMessageId, emoji);
  }

  private async onImdbResolve({ request, imdbId, replyMessageId }: AdminImdbResolveEvent): Promise<void> {
    if (!request.media) {
      AppService.logger.warn(`Request ${request.mediaId} has no media attached`);
      return;
    }

    AppService.logger.log(`Resolving IMDb ID for media "${request.media.title}" → ${imdbId}`);
    await this.mediasRepository.updateImdbId(request.media.id, imdbId);
    await this.adminsMessaging.reactToMessage(replyMessageId, '✅');
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
