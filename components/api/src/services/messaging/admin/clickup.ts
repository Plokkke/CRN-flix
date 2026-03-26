import { Logger } from '@nestjs/common';

import { ClickUpService } from '@/services/clickup';
import { MediaEntity } from '@/services/database/medias';
import { RequestEntity, RequestsRepository, RequestStatus } from '@/services/database/requests';
import { truthy } from '@/utils';

const CLICKUP_STATUS_BY_REQUEST_STATUS: Partial<Record<RequestStatus, string>> = {
  [RequestStatus.Pending]: 'Open',
  [RequestStatus.Fulfilled]: 'Closed',
  [RequestStatus.Rejected]: 'rejected',
};

function mediaName(media: MediaEntity): string {
  return `${media.title} (${media.year}) ${media.type === 'episode' ? `S${media.seasonNumber}E${media.episodeNumber}` : ''}`;
}

function buildDescription(media: MediaEntity, userNames: string[], darkiworldUrl?: string | null): string {
  const userNamesText = userNames.length > 0 ? userNames.join(', ') : 'Aucun utilisateur associé';
  return [
    `- Type: ${media.type}`,
    `- Titre: ${media.title} (${media.year})`,
    ...(media.type === 'episode' ? [`- Saison: ${media.seasonNumber}`, `- Épisode: ${media.episodeNumber}`] : []),
    `- IMDb ID: ${media.imdbId}`,
    `- Utilisateurs: ${userNamesText}`,
    ...(darkiworldUrl ? [`- Darkiworld: ${darkiworldUrl}`] : []),
  ].join('\n');
}

export class ClickUpAdminMessaging {
  private static readonly logger = new Logger(ClickUpAdminMessaging.name);

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

  async register(request: RequestEntity): Promise<RequestEntity> {
    const media = request.media!;

    const title = mediaName(media);
    const userNames = request.userRequests?.map((ur) => ur.user?.name).filter(truthy) || [];
    const description = buildDescription(media, userNames, request.darkiworldUrl);
    const tags = [media.type];

    try {
      request.taskId = await this.clickupService.createTask(title, description, tags);
      await this.requestsRepository.attachTask(request.mediaId, request.taskId);

      ClickUpAdminMessaging.logger.log(`ClickUp task created successfully: ${request.taskId} for media ${media.title}`);
    } catch (error) {
      ClickUpAdminMessaging.logger.error(`Failed to create ClickUp task for media ${media.title}`, error);
      throw error;
    }

    return request;
  }

  async updateMediaStatus(request: RequestEntity): Promise<void> {
    const clickupStatus = CLICKUP_STATUS_BY_REQUEST_STATUS[request.status];
    if (!clickupStatus || !request.taskId) {
      return;
    }

    try {
      await this.clickupService.updateTaskStatus(request.taskId, clickupStatus);
      ClickUpAdminMessaging.logger.log(`Updated ClickUp task ${request.taskId} status(${clickupStatus})`);
    } catch (error) {
      ClickUpAdminMessaging.logger.error(`Failed to update ClickUp task ${request.taskId}`, error);
      throw error;
    }
  }

  async deleteTask(request: RequestEntity): Promise<void> {
    if (!request.taskId) {
      return;
    }

    try {
      await this.clickupService.deleteTask(request.taskId);
      ClickUpAdminMessaging.logger.log(`Deleted ClickUp task ${request.taskId}`);
    } catch (error) {
      ClickUpAdminMessaging.logger.error(`Failed to delete ClickUp task ${request.taskId}`, error);
    }
  }

  async updateTaskUsers(request: RequestEntity): Promise<void> {
    if (!request.taskId) {
      return;
    }

    const media = request.media!;
    const userNames = request.userRequests?.map((ur) => ur.user?.name).filter(truthy) || [];

    const description = buildDescription(media, userNames);

    try {
      await this.clickupService.updateTaskDescription(request.taskId, description);
      ClickUpAdminMessaging.logger.log(`Updated ClickUp task ${request.taskId} users list`);
    } catch (error) {
      ClickUpAdminMessaging.logger.error(`Failed to update ClickUp task users for ${request.taskId}`, error);
    }
  }
}
