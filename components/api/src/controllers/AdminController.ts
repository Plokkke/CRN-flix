import { Controller, Get, Header, Logger, Param, Post, Query, Res } from '@nestjs/common';
import { Response } from 'express';

import { ContextService } from '@/services/context';
import { DarkiworldSyncService } from '@/services/darkiworld-sync';
import { RequestsRepository } from '@/services/database/requests';
import { JellyfinSyncService } from '@/services/jellyfin-sync';
import { adminDashboardTemplate } from '@/services/messaging/user/email/templates/admin-dashboard';
import { TraktSyncService } from '@/services/trakt-sync';

const JOBS = [
  { name: 'trakt-sync', schedule: 'Every 5 minutes' },
  { name: 'darkiworld-sync', schedule: 'Every hour' },
  { name: 'jellyfin-sync', schedule: 'Every 15 minutes' },
] as const;

type JobName = (typeof JOBS)[number]['name'];

@Controller('admin')
export class AdminController {
  private static readonly logger = new Logger(AdminController.name);

  private readonly jobHandlers: Record<JobName, () => Promise<void>>;

  constructor(
    private readonly contextService: ContextService,
    private readonly traktSync: TraktSyncService,
    private readonly jellyfinSync: JellyfinSyncService,
    private readonly darkiworldSync: DarkiworldSyncService,
    private readonly requestsRepository: RequestsRepository,
  ) {
    this.jobHandlers = {
      'trakt-sync': () => this.traktSync.sync(),
      'darkiworld-sync': () => this.darkiworldSync.sync(),
      'jellyfin-sync': () => this.jellyfinSync.sync(),
    };
  }

  @Get()
  @Header('content-type', 'text/html')
  async getDashboard(@Query('message') message?: string): Promise<string> {
    const requests = await this.requestsRepository.listAllWithDetails();

    return adminDashboardTemplate({
      serviceName: this.contextService.name,
      requests,
      jobs: [...JOBS],
      flashMessage: message,
    });
  }

  @Post('jobs/:name')
  triggerJob(@Param('name') name: string, @Res() res: Response): void {
    const handler = this.jobHandlers[name as JobName];
    if (!handler) {
      res.redirect(`/admin?message=Unknown job: ${name}`);
      return;
    }

    handler().catch((error) => {
      AdminController.logger.error(`Job "${name}" failed: ${error instanceof Error ? error.message : error}`);
    });

    res.redirect(`/admin?message=Job "${name}" triggered`);
  }

  @Get('requests')
  async listRequests(): Promise<unknown> {
    return this.requestsRepository.listAllWithDetails();
  }
}
