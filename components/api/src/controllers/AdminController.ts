import { Body, Controller, Get, Header, Logger, Param, Post, Query, Res } from '@nestjs/common';
import { Response } from 'express';

import { ContextService } from '@/services/context';
import { NamingAuditRepository } from '@/services/database/naming-audit';
import { RequestsRepository } from '@/services/database/requests';
import { DiscordSyncService } from '@/services/discord-sync';
import { IndexerSyncService } from '@/services/indexer-sync';
import { JellyfinSyncService } from '@/services/jellyfin-sync';
import { adminDashboardTemplate } from '@/services/messaging/user/email/templates/admin-dashboard';
import { adminNamingAuditTemplate } from '@/services/messaging/user/email/templates/admin-naming-audit';
import { NamingAuditService } from '@/services/naming-audit';
import { TraktSyncService } from '@/services/trakt-sync';

const JOBS = [
  { name: 'trakt-sync', schedule: 'Every 5 minutes' },
  { name: 'indexer-sync', schedule: 'Every hour' },
  { name: 'jellyfin-sync', schedule: 'Every 15 minutes' },
  { name: 'discord-sync', schedule: 'Every 5 minutes' },
  { name: 'naming-audit', schedule: 'Manual only' },
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
    private readonly indexerSync: IndexerSyncService,
    private readonly discordSync: DiscordSyncService,
    private readonly requestsRepository: RequestsRepository,
    private readonly namingAudit: NamingAuditService,
    private readonly namingAuditRepository: NamingAuditRepository,
  ) {
    this.jobHandlers = {
      'trakt-sync': () => this.traktSync.sync(),
      'indexer-sync': () => this.indexerSync.sync(),
      'jellyfin-sync': () => this.jellyfinSync.sync(),
      'discord-sync': () => this.discordSync.sync(),
      'naming-audit': async () => {
        await this.namingAudit.run();
      },
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

    if (name === 'naming-audit') {
      res.redirect(`/admin/naming-audit?message=Audit started — refresh in a moment to see results`);
      return;
    }

    res.redirect(`/admin?message=Job "${name}" triggered`);
  }

  @Get('requests')
  async listRequests(): Promise<unknown> {
    return this.requestsRepository.listAllWithDetails();
  }

  @Get('naming-audit')
  @Header('content-type', 'text/html')
  async getNamingAudit(@Query('message') message?: string): Promise<string> {
    const runId = await this.namingAuditRepository.getLatestRunId();
    const items = runId ? await this.namingAuditRepository.listByRun(runId) : [];

    return adminNamingAuditTemplate({
      serviceName: this.contextService.name,
      runId,
      items,
      flashMessage: message,
    });
  }

  @Post('naming-audit/apply')
  async applyNamingAudit(@Body('itemIds') itemIds: string | string[] | undefined, @Res() res: Response): Promise<void> {
    const ids = Array.isArray(itemIds) ? itemIds : itemIds ? [itemIds] : [];

    if (ids.length === 0) {
      res.redirect('/admin/naming-audit?message=No items selected');
      return;
    }

    try {
      const { applied, failed } = await this.namingAudit.apply(ids);
      res.redirect(`/admin/naming-audit?message=Applied ${applied}, failed ${failed}`);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      AdminController.logger.error(`Naming audit apply failed: ${msg}`);
      res.redirect(`/admin/naming-audit?message=Error: ${encodeURIComponent(msg)}`);
    }
  }
}
