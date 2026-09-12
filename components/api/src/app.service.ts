import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';

import { Config } from '@/app.module';
import { Listener } from '@/helpers/events';
import { JellyfinMediaService } from '@/modules/jellyfin/jellyfin';
import {
  DownloadJobEntity,
  DownloadJobEvents,
  DownloadJobsRepository,
  DownloadJobStatus,
  DownloadJobStatusChangedEvent,
} from '@/services/database/download-jobs';
import { PlannedDownloadEvents, PlannedDownloadsRepository } from '@/services/database/planned-downloads';
import {
  RequestCreatedEvent,
  RequestEvents,
  RequestsRepository,
  RequestStatus,
  RequestStatusChangedEvent,
  UserJoinedRequestEvent,
  UserLeftRequestEvent,
} from '@/services/database/requests';
import { UserNotificationsRepository } from '@/services/database/user-notifications';
import { UsersRepository } from '@/services/database/users';
import { FetchrSyncService } from '@/services/fetchr-sync';
import { JellyfinSyncService } from '@/services/jellyfin-sync';
import { isUserNotifiableStatus } from '@/services/messaging/user';
import { AllUserMessaging } from '@/services/messaging/user/all';
import { PlannerService } from '@/services/planner/planner';
import { PostDownloadPipeline } from '@/services/post-download-pipeline';
import { downloadActionResolution, isIdentificationError } from '@/services/tickets/auto-resolve';
import { TICKET_ID_METADATA_KEY, TicketCategory } from '@/services/tickets/model';
import { actionTitle } from '@/services/tickets/presenter';
import { TicketReconcilerService } from '@/services/tickets/reconciler';
import { TicketService } from '@/services/tickets/ticket.service';
import { TraktSyncService } from '@/services/trakt-sync';

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
    private readonly planner: PlannerService,
    private readonly ticketService: TicketService,
    private readonly ticketReconciler: TicketReconcilerService,
    private readonly jellyfin: JellyfinMediaService,
    private readonly messaging: AllUserMessaging,
    private readonly usersRepository: UsersRepository,
    private readonly requestsRepository: RequestsRepository,
    private readonly plannedDownloads: PlannedDownloadsRepository,
    private readonly userNotifications: UserNotificationsRepository,
    private readonly fetchrSync: FetchrSyncService,
    private readonly postDownloadPipeline: PostDownloadPipeline,
    private readonly downloadJobs: DownloadJobsRepository,
  ) {}

  onModuleInit(): void {
    this.listeners.push(
      this.listenRequestsEvents(),
      this.listenDownloadJobEvents(),
      this.listenPlannedDownloadEvents(),
    );

    if (process.env.NODE_ENV === 'production') {
      this.registerCronJob('trakt-sync-job', '*/5 * * * *', () => this.runSync());
      this.registerCronJob('planner-job', '0 * * * *', () => this.planner.runAll());
      this.registerCronJob('jellyfin-sync-job', '*/15 * * * *', () => this.jellyfinSync.sync());
      this.registerCronJob('ticket-sync-job', '*/5 * * * *', () => this.ticketReconciler.sync());
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

  private async schedulePlannerPassForRequest(requestId: string): Promise<void> {
    const request = await this.requestsRepository.get(requestId);
    if (request?.media) {
      this.planner.schedulePassForMedia(request.media);
    }
  }

  private listenRequestsEvents(): Listener<RequestEvents> {
    return this.requestsRepository.listen({
      created: (event: RequestCreatedEvent) =>
        this.trackEvent(() => this.schedulePlannerPassForRequest(event.requestId)),
      statusChange: (event: RequestStatusChangedEvent) =>
        this.trackEvent(async () => {
          AppService.logger.log(`Status change event: ${event.requestId} (${event.oldStatus} → ${event.newStatus})`);
          const request = await this.requestsRepository.get(event.requestId);
          if (!request) {
            AppService.logger.warn(`Request ${event.requestId} not found for status change event`);
            return;
          }

          // The planner reconciles with observed reality: fulfilled and rejected are
          // external facts; pending/missing oscillations are its own doing.
          if (request.status === RequestStatus.Fulfilled || request.status === RequestStatus.Rejected) {
            if (request.media) {
              this.planner.schedulePassForMedia(request.media);
            }
          }

          if (!isUserNotifiableStatus(request.status)) {
            AppService.logger.debug(
              `Skipping user notifications for request ${event.requestId} (status ${request.status} is transient)`,
            );
            return;
          }

          const userIds = request.userRequests?.map((user) => user.userId) ?? [];
          AppService.logger.log(`Notifying ${userIds.length} users for request ${event.requestId}`);
          for (const userId of userIds) {
            const user = await this.usersRepository.get(userId);
            if (!user) {
              AppService.logger.warn(`User ${userId} not found for notification`);
              continue;
            }

            if (!(await this.userNotifications.claim(userId, request.mediaId, request.status))) {
              AppService.logger.debug(`User ${user.name} already notified for ${request.mediaId} (${request.status})`);
              continue;
            }

            AppService.logger.debug(
              `Sending notification to user ${user.name} (${user.messagingKey}:${user.messagingId})`,
            );
            const userCtxt = { key: user.messagingKey, id: user.messagingId };
            await this.messaging.requestUpdated(userCtxt, request);
          }
        }),
      userJoined: (event: UserJoinedRequestEvent) =>
        this.trackEvent(async () => {
          const user = await this.usersRepository.get(event.userId);
          const request = await this.requestsRepository.get(event.requestId);
          if (!request || !user) {
            return;
          }

          if (request.media) {
            this.planner.schedulePassForMedia(request.media);
          }

          if (!isUserNotifiableStatus(request.status)) {
            AppService.logger.debug(
              `Skipping user notifications for request ${event.requestId} (status ${request.status} is transient)`,
            );
            return;
          }

          if (!(await this.userNotifications.claim(event.userId, request.mediaId, request.status))) {
            AppService.logger.debug(`User ${user.name} already notified for ${request.mediaId} (${request.status})`);
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

          if (request.media) {
            this.planner.schedulePassForMedia(request.media);
          }

          const deletableStatuses = [RequestStatus.Missing, RequestStatus.Pending];
          if (request.userRequests?.length === 0 && deletableStatuses.includes(request.status)) {
            await this.requestsRepository.removeRequest(request.mediaId);
          }
        }),
    });
  }

  /** Every planner action lives as a ticket; its lifecycle drives the ticket's. */
  private listenPlannedDownloadEvents(): Listener<PlannedDownloadEvents> {
    return this.plannedDownloads.listen({
      created: ({ actionId }) =>
        this.trackEvent(async () => {
          const action = await this.plannedDownloads.get(actionId);
          if (action) {
            await this.ticketService.open(
              TicketCategory.DownloadAction,
              { type: 'planned_download', id: actionId },
              { actionId },
              { title: actionTitle(action) },
            );
          }
        }),
      statusChange: ({ actionId, oldStatus, newStatus }) =>
        this.trackEvent(async () => {
          AppService.logger.log(`Action ${actionId}: ${oldStatus} → ${newStatus}`);
          const action = await this.plannedDownloads.get(actionId);
          if (!action) {
            return;
          }

          const { close, resolution } = downloadActionResolution(action.status, action.coveredStatuses);
          if (close) {
            await this.ticketService.resolveBySubject(
              TicketCategory.DownloadAction,
              'planned_download',
              actionId,
              resolution ?? newStatus,
            );
            return;
          }
          await this.ticketService.recordSystemEventForSubject(
            TicketCategory.DownloadAction,
            'planned_download',
            actionId,
            `Statut : ${oldStatus} → ${newStatus}`,
          );
        }),
      labelChange: ({ actionId, oldLabel, newLabel }) =>
        this.trackEvent(async () => {
          await this.ticketService.recordSystemEventForSubject(
            TicketCategory.DownloadAction,
            'planned_download',
            actionId,
            `Priorité : ${oldLabel} → ${newLabel}`,
          );
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
            await this.openJobFailureTicket(job);
          } else if (event.newStatus === DownloadJobStatus.Completed) {
            await this.onJobCompleted(job);
          }
        }),
    });
  }

  private async openJobFailureTicket(job: DownloadJobEntity): Promise<void> {
    AppService.logger.warn(`Download job ${job.id} failed: ${job.errorMessage}`);
    const failedFiles = job.sourcePaths.map((p) => p.split('/').pop()).filter(Boolean) as string[];
    const errorMessage = job.errorMessage ?? 'Unknown error';
    const packageName = job.packageName || 'unknown';

    if (isIdentificationError(errorMessage)) {
      await this.ticketService.open(
        TicketCategory.IdentificationFailure,
        { type: 'download_job', id: job.id },
        {
          jobId: job.id,
          packageName,
          failedFiles: failedFiles.length > 0 ? failedFiles : [packageName],
          errorMessage,
        },
        { title: `Identification échouée — ${packageName}` },
      );
      return;
    }

    // Dead-letter: no automated recovery, but at least it now has an identity and a timeline.
    await this.ticketService.open(
      TicketCategory.PipelineFailure,
      { type: 'download_job', id: job.id },
      { jobId: job.id, fileNames: failedFiles.join(', ') || packageName, failedStep: job.status, errorMessage },
      { title: `Échec pipeline — ${packageName}` },
    );
  }

  private async onJobCompleted(job: DownloadJobEntity): Promise<void> {
    AppService.logger.log(`Download job ${job.id} completed`);
    await this.jellyfin.refreshLibrary();
    await this.requestsRepository.fulfillByJobId(job.id);
    this.fetchrSync.remove(job.sourceId);

    await this.ticketService.resolveBySubject(
      TicketCategory.IdentificationFailure,
      'download_job',
      job.id,
      'Identification aboutie',
    );

    const ticketId = job.metadata?.[TICKET_ID_METADATA_KEY];
    if (ticketId) {
      await this.ticketService.resolveById(ticketId, 'Téléchargement abouti');
    }
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
