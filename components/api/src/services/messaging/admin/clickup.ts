import { Logger } from '@nestjs/common';

import { ClickUpService } from '@/services/clickup';
import { MediaEntity } from '@/services/database/medias';
import { RequestEntity, RequestsRepository, RequestStatus } from '@/services/database/requests';
import { truthy } from '@/utils';

const CLICKUP_STATUS_BY_REQUEST_STATUS: Record<RequestStatus, string> = {
  pending: 'Open',
  fulfilled: 'Closed',
  missing: 'missing',
  rejected: 'rejected',
  canceled: 'canceled',
};

function mediaName(media: MediaEntity): string {
  return `${media.title} (${media.year}) ${media.type === 'episode' ? `S${media.seasonNumber}E${media.episodeNumber}` : ''}`;
}

function buildDescription(media: MediaEntity, userNames: string[]): string {
  const userNamesText = userNames.length > 0 ? userNames.join(', ') : 'Aucun utilisateur associé';
  return [
    `- Type: ${media.type}`,
    `- Titre: ${media.title} (${media.year})`,
    ...(media.type === 'episode' ? [`- Saison: ${media.seasonNumber}`, `- Épisode: ${media.episodeNumber}`] : []),
    `- IMDb ID: ${media.imdbId}`,
    `- Utilisateurs: ${userNamesText}`,
  ].join('\n');
}

export class ClickUpAdminMessaging {
  private static readonly logger = new Logger(ClickUpAdminMessaging.name);
  private readonly pendingRegistrations = new Map<
    string,
    {
      promise: Promise<string>;
      resolve: (taskId: string) => void;
    }
  >();

  static async create(
    clickupService: ClickUpService,
    requestsRepository: RequestsRepository,
  ): Promise<ClickUpAdminMessaging> {
    return new ClickUpAdminMessaging(clickupService, requestsRepository);
  }

  private constructor(
    private readonly clickupService: ClickUpService,
    private readonly requestsRepository: RequestsRepository,
  ) {}

  private async assertHavingTaskId(request: RequestEntity): Promise<string> {
    if (request.taskId) {
      return request.taskId;
    }

    ClickUpAdminMessaging.logger.debug(`No taskId for request ${request.mediaId}, waiting for registration...`);

    const pendingRegistration = this.pendingRegistrations.get(request.mediaId);
    if (pendingRegistration) {
      return pendingRegistration.promise;
    } else {
      let resolve: (taskId: string) => void;
      const promise = new Promise<string>((done) => {
        resolve = done;
      });
      this.pendingRegistrations.set(request.mediaId, { promise, resolve: resolve! });

      return promise;
    }
  }

  private async completeRegistration(mediaId: string, taskId: string): Promise<void> {
    await this.requestsRepository.attachTask(mediaId, taskId);

    const pendingRegistration = this.pendingRegistrations.get(mediaId);
    if (pendingRegistration) {
      ClickUpAdminMessaging.logger.debug(`ClickUp task registration completed: ${taskId} for media ${mediaId}`);
      pendingRegistration.resolve(taskId);
      this.pendingRegistrations.delete(mediaId);
    }
  }

  async register(request: RequestEntity): Promise<RequestEntity> {
    const media = request.media!;

    const title = mediaName(media);
    const description = buildDescription(media, request.userRequests?.map((ur) => ur.user?.name).filter(truthy) || []);
    const tags = [media.type];

    try {
      request.taskId = await this.clickupService.createTask(title, description, tags);
      await this.completeRegistration(request.mediaId, request.taskId);

      ClickUpAdminMessaging.logger.log(`ClickUp task created successfully: ${request.taskId} for media ${media.title}`);
    } catch (error) {
      ClickUpAdminMessaging.logger.error(`Failed to create ClickUp task for media ${media.title}`, error);
      throw error;
    }

    return request;
  }

  async updateMediaStatus(request: RequestEntity): Promise<void> {
    const taskId = await this.assertHavingTaskId(request);

    const clickupStatus = CLICKUP_STATUS_BY_REQUEST_STATUS[request.status];

    try {
      await this.clickupService.updateTaskStatus(taskId, clickupStatus);
      ClickUpAdminMessaging.logger.log(`Updated ClickUp task ${request.taskId} status(${clickupStatus})`);
    } catch (error) {
      ClickUpAdminMessaging.logger.error(`Failed to update ClickUp task ${request.taskId}`, error);
      throw error;
    }
  }

  async updateTaskUsers(request: RequestEntity): Promise<void> {
    const taskId = await this.assertHavingTaskId(request);

    const media = request.media!;
    const userNames = request.userRequests?.map((ur) => ur.user?.name).filter(truthy) || [];

    const description = buildDescription(media, userNames);

    try {
      await this.clickupService.updateTaskDescription(taskId, description);
      ClickUpAdminMessaging.logger.log(`Updated ClickUp task ${taskId} users list`);
    } catch (error) {
      ClickUpAdminMessaging.logger.error(`Failed to update ClickUp task users for ${taskId}`, error);
    }
  }
}
