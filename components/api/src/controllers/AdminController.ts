import {
  Body,
  Controller,
  Get,
  Header,
  Logger,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import { Request, Response } from 'express';

import { SessionAuthRedirectFilter } from '@/filters/session-auth-redirect.filter';
import { AdminSessionGuard, SkipAdminAuth } from '@/guards/admin-session.guard';
import { readCookie } from '@/helpers/cookies';
import { executionByTrack, ExecutionView } from '@/services/admin/execution';
import { buildDashboard, DashboardTab, TABS } from '@/services/admin/requests-view';
import { ADMIN_SESSION_COOKIE, AdminAuthService, CodeRequestOutcome } from '@/services/admin-auth';
import { ContextService } from '@/services/context';
import { DownloadJobsRepository } from '@/services/database/download-jobs';
import { IndexerBookmarksRepository } from '@/services/database/indexer-bookmarks';
import { NamingAuditRepository } from '@/services/database/naming-audit';
import { PlannedDownloadsRepository } from '@/services/database/planned-downloads';
import { PlannerFindingsRepository } from '@/services/database/planner-findings';
import { RequestStatesRepository } from '@/services/database/request-states';
import { RequestsRepository } from '@/services/database/requests';
import { TicketsRepository } from '@/services/database/tickets';
import { FetchrSyncService } from '@/services/fetchr-sync';
import { JellyfinSyncService } from '@/services/jellyfin-sync';
import { adminDashboardTemplate } from '@/services/messaging/user/email/templates/admin-dashboard';
import { adminLoginTemplate } from '@/services/messaging/user/email/templates/admin-login';
import { adminNamingAuditTemplate } from '@/services/messaging/user/email/templates/admin-naming-audit';
import { NamingAuditService } from '@/services/naming-audit';
import { PlannerService } from '@/services/planner/planner';
import { TicketReconcilerService } from '@/services/tickets/reconciler';
import { TraktSyncService } from '@/services/trakt-sync';
import { truthy } from '@/utils';

const JOBS = [
  { name: 'trakt-sync', schedule: 'Every 5 minutes' },
  { name: 'planner', schedule: 'Every hour' },
  { name: 'jellyfin-sync', schedule: 'Every 15 minutes' },
  { name: 'ticket-sync', schedule: 'Every 5 minutes' },
  { name: 'naming-audit', schedule: 'Manual only' },
] as const;

type JobName = (typeof JOBS)[number]['name'];

const parseTab = (tab: string | undefined): DashboardTab =>
  TABS.some((t) => t.key === tab) ? (tab as DashboardTab) : 'download';

const CODE_REQUEST_MESSAGES: Record<CodeRequestOutcome, string> = {
  sent: 'Code envoyé sur Discord.',
  throttled: 'Un code vient déjà d’être envoyé, patientez 30 secondes.',
  'delivery-failed': 'Impossible d’envoyer le code sur Discord.',
};

@Controller('admin')
@UseGuards(AdminSessionGuard)
@UseFilters(SessionAuthRedirectFilter)
export class AdminController {
  private static readonly logger = new Logger(AdminController.name);

  private readonly jobHandlers: Record<JobName, () => Promise<void>>;

  constructor(
    private readonly adminAuth: AdminAuthService,
    private readonly contextService: ContextService,
    private readonly traktSync: TraktSyncService,
    private readonly jellyfinSync: JellyfinSyncService,
    private readonly planner: PlannerService,
    private readonly ticketReconciler: TicketReconcilerService,
    private readonly requestsRepository: RequestsRepository,
    private readonly indexerBookmarks: IndexerBookmarksRepository,
    private readonly requestStates: RequestStatesRepository,
    private readonly findings: PlannerFindingsRepository,
    private readonly plannedDownloads: PlannedDownloadsRepository,
    private readonly tickets: TicketsRepository,
    private readonly downloadJobs: DownloadJobsRepository,
    private readonly fetchr: FetchrSyncService,
    private readonly namingAudit: NamingAuditService,
    private readonly namingAuditRepository: NamingAuditRepository,
  ) {
    this.jobHandlers = {
      'trakt-sync': () => this.traktSync.sync(),
      planner: () => this.planner.runAll(),
      'jellyfin-sync': () => this.jellyfinSync.sync(),
      'ticket-sync': () => this.ticketReconciler.sync(),
      'naming-audit': async () => {
        await this.namingAudit.run();
      },
    };
  }

  @Get('login')
  @SkipAdminAuth()
  async getLogin(
    @Req() req: Request,
    @Res() res: Response,
    @Query('step') step?: string,
    @Query('message') message?: string,
  ): Promise<void> {
    const token = readCookie(req.headers.cookie, ADMIN_SESSION_COOKIE);
    if (token && (await this.adminAuth.validateSession(token))) {
      res.redirect('/admin');
      return;
    }

    res.type('html').send(
      adminLoginTemplate({
        serviceName: this.contextService.name,
        step: step === 'code' ? 'code' : 'request',
        message,
      }),
    );
  }

  @Post('login/request')
  @SkipAdminAuth()
  async requestLoginCode(@Res() res: Response): Promise<void> {
    const outcome = await this.adminAuth.requestCode();
    const step = outcome === 'delivery-failed' ? 'request' : 'code';
    res.redirect(`/admin/login?step=${step}&message=${encodeURIComponent(CODE_REQUEST_MESSAGES[outcome])}`);
  }

  @Post('login/verify')
  @SkipAdminAuth()
  async verifyLoginCode(
    @Body('code') code: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const token = code ? await this.adminAuth.verifyCode(code, req.headers['user-agent'] ?? null) : null;
    if (!token) {
      res.redirect(`/admin/login?step=code&message=${encodeURIComponent('Code invalide ou expiré.')}`);
      return;
    }

    res.cookie(ADMIN_SESSION_COOKIE, token, this.adminAuth.cookieOptions);
    res.redirect('/admin');
  }

  @Post('logout')
  async logout(@Req() req: Request, @Res() res: Response): Promise<void> {
    const token = readCookie(req.headers.cookie, ADMIN_SESSION_COOKIE);
    if (token) {
      await this.adminAuth.revokeSession(token);
    }
    res.clearCookie(ADMIN_SESSION_COOKIE, this.adminAuth.cookieOptions);
    res.redirect('/admin/login');
  }

  @Get()
  @Header('content-type', 'text/html')
  async getDashboard(@Query('tab') tab?: string, @Query('message') message?: string): Promise<string> {
    const requests = await this.requestsRepository.listAllWithDetails();
    const imdbIds = [...new Set(requests.map((r) => r.media?.imdbId).filter(truthy))];
    const [states, bookmarks, actions, tickets, findings, lastPassAt, jobs] = await Promise.all([
      this.requestStates.listAll(),
      this.indexerBookmarks.listByImdbIds(imdbIds),
      this.plannedDownloads.listLive(),
      this.tickets.listOpen(),
      this.findings.listAll(),
      this.requestStates.latestPlannedAt(),
      this.downloadJobs.listInProgress(),
    ]);

    const dashboard = buildDashboard({
      requests,
      states,
      bookmarks,
      actions,
      tickets,
      findings,
      prefs: this.contextService.indexerPreferences,
      lastPassAt,
      jobs,
      downloads: this.fetchr.liveDownloads(),
    });

    return adminDashboardTemplate({
      serviceName: this.contextService.name,
      dashboard,
      activeTab: parseTab(tab),
      jobs: [...JOBS],
      flashMessage: message,
    });
  }

  /** Execution of every live action and hand launch (download, extraction), polled every 30s. */
  @Get('requests/progress')
  async getProgress(): Promise<Record<string, ExecutionView>> {
    return executionByTrack(
      await this.plannedDownloads.listLive(),
      this.fetchr.liveDownloads(),
      await this.downloadJobs.listInProgress(),
    );
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
