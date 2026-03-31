import { Logger } from '@nestjs/common';

import { RequestsRepository } from './database/requests';
import { DiscordAdminMessaging } from './messaging/admin/discord';

export class DiscordSyncService {
  private static readonly logger = new Logger(DiscordSyncService.name);

  constructor(
    private readonly requestsRepository: RequestsRepository,
    private readonly adminsMessaging: DiscordAdminMessaging,
  ) {}

  async sync(): Promise<void> {
    const requests = await this.requestsRepository.findRequestsWithoutThread();

    if (requests.length === 0) {
      return;
    }

    DiscordSyncService.logger.log(`Found ${requests.length} pending requests without Discord message`);

    for (const request of requests) {
      try {
        await this.adminsMessaging.registerRequest(request);
        DiscordSyncService.logger.log(`Created Discord message for "${request.media?.title}"`);
      } catch (error) {
        DiscordSyncService.logger.error(
          `Failed to create Discord message for "${request.media?.title}": ${error instanceof Error ? error.message : error}`,
        );
      }
    }

    DiscordSyncService.logger.log(`Discord sync completed`);
  }
}
