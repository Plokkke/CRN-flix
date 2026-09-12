import { Body, Controller, Get, Header, Post, Query, Req, Res, UseFilters, UseGuards } from '@nestjs/common';
import { Request, Response } from 'express';

import { SessionAuthRedirectFilter } from '@/filters/session-auth-redirect.filter';
import { SkipSessionAuth } from '@/guards/session.guard';
import { USER_REQUEST_KEY, UserSessionGuard } from '@/guards/user-session.guard';
import { readCookie } from '@/helpers/cookies';
import { executionByTrack, ExecutionView } from '@/services/admin/execution';
import { buildDashboard, Dashboard } from '@/services/admin/requests-view';
import { ContextService } from '@/services/context';
import { DownloadJobsRepository } from '@/services/database/download-jobs';
import { PlannedDownloadEntity, PlannedDownloadsRepository } from '@/services/database/planned-downloads';
import { PlannerFindingsRepository } from '@/services/database/planner-findings';
import { RequestStatesRepository } from '@/services/database/request-states';
import { RequestEntity, RequestsRepository } from '@/services/database/requests';
import { UsersRepository } from '@/services/database/users';
import { FetchrSyncService } from '@/services/fetchr-sync';
import { userLoginTemplate } from '@/services/messaging/user/email/templates/user-login';
import { parseUserSpaceTab, userSpaceTemplate } from '@/services/messaging/user/email/templates/user-space';
import {
  CHALLENGE_TTL_MINUTES,
  USER_LOGIN_COOKIE,
  USER_SESSION_COOKIE,
  USER_SPACE_PATH,
  UserAuthService,
  UserCodeRequestOutcome,
} from '@/services/user-auth';

const LOGIN_PATH = `${USER_SPACE_PATH}/login`;

const CODE_REQUEST_MESSAGES: Record<UserCodeRequestOutcome, string> = {
  sent: 'Code envoyé. Vérifiez vos emails ou vos messages privés Discord.',
  throttled: 'Un code vient déjà d’être envoyé, patientez 30 secondes.',
  'delivery-failed': 'Impossible d’envoyer le code. Contactez l’administrateur.',
  'unknown-user': 'Pseudo inconnu ou compte pas encore activé.',
};

const STEP_BY_OUTCOME: Record<UserCodeRequestOutcome, 'request' | 'code'> = {
  sent: 'code',
  throttled: 'code',
  'delivery-failed': 'request',
  'unknown-user': 'request',
};

const loginRedirect = (step: 'request' | 'code', message: string): string =>
  `${LOGIN_PATH}?step=${step}&message=${encodeURIComponent(message)}`;

@Controller('me')
@UseGuards(UserSessionGuard)
@UseFilters(SessionAuthRedirectFilter)
export class MeController {
  constructor(
    private readonly userAuth: UserAuthService,
    private readonly contextService: ContextService,
    private readonly usersRepository: UsersRepository,
    private readonly requestsRepository: RequestsRepository,
    private readonly requestStates: RequestStatesRepository,
    private readonly plannedDownloads: PlannedDownloadsRepository,
    private readonly downloadJobs: DownloadJobsRepository,
    private readonly findings: PlannerFindingsRepository,
    private readonly fetchr: FetchrSyncService,
  ) {}

  @Get('login')
  @SkipSessionAuth()
  async getLogin(
    @Req() req: Request,
    @Res() res: Response,
    @Query('step') step?: string,
    @Query('message') message?: string,
  ): Promise<void> {
    const token = readCookie(req.headers.cookie, USER_SESSION_COOKIE);
    if (token && (await this.userAuth.validateSession(token))) {
      res.redirect(USER_SPACE_PATH);
      return;
    }

    res.type('html').send(
      userLoginTemplate({
        serviceName: this.contextService.name,
        step: step === 'code' ? 'code' : 'request',
        message,
        basePath: USER_SPACE_PATH,
        expiresInMinutes: CHALLENGE_TTL_MINUTES,
      }),
    );
  }

  @Post('login/request')
  @SkipSessionAuth()
  async requestLoginCode(@Body('username') username: string | undefined, @Res() res: Response): Promise<void> {
    const { outcome, userId } = await this.userAuth.requestCode(username ?? '');
    if (userId && STEP_BY_OUTCOME[outcome] === 'code') {
      res.cookie(USER_LOGIN_COOKIE, userId, this.userAuth.loginCookieOptions);
    }
    res.redirect(loginRedirect(STEP_BY_OUTCOME[outcome], CODE_REQUEST_MESSAGES[outcome]));
  }

  @Post('login/verify')
  @SkipSessionAuth()
  async verifyLoginCode(
    @Body('code') code: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const userId = readCookie(req.headers.cookie, USER_LOGIN_COOKIE);
    const token = userId && code ? await this.userAuth.verifyCode(userId, code, this.userAgent(req)) : null;
    if (!token) {
      res.redirect(loginRedirect('code', 'Code invalide ou expiré.'));
      return;
    }
    this.openSession(res, token);
  }

  @Get('login/link')
  @SkipSessionAuth()
  async verifyLoginLink(
    @Query('u') userId: string | undefined,
    @Query('t') linkToken: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const token = userId && linkToken ? await this.userAuth.verifyLink(userId, linkToken, this.userAgent(req)) : null;
    if (!token) {
      res.redirect(loginRedirect('request', 'Lien invalide ou expiré. Demandez un nouveau code.'));
      return;
    }
    this.openSession(res, token);
  }

  @Post('logout')
  async logout(@Req() req: Request, @Res() res: Response): Promise<void> {
    const token = readCookie(req.headers.cookie, USER_SESSION_COOKIE);
    if (token) {
      await this.userAuth.revokeSession(token);
    }
    res.clearCookie(USER_SESSION_COOKIE, this.userAuth.cookieOptions);
    res.redirect(LOGIN_PATH);
  }

  @Get()
  @Header('content-type', 'text/html')
  async getSpace(@Req() req: Request, @Query('tab') tab?: string, @Query('message') message?: string): Promise<string> {
    const userId = (req as Request & Record<string, string>)[USER_REQUEST_KEY];
    const [user, dashboard] = await Promise.all([this.usersRepository.get(userId), this.dashboardOf(userId)]);

    return userSpaceTemplate({
      serviceName: this.contextService.name,
      userName: user?.name ?? 'abonné',
      dashboard,
      activeTab: parseUserSpaceTab(tab),
      basePath: USER_SPACE_PATH,
      mediaServerUrl: this.contextService.mediaServerUrl,
      flashMessage: message,
    });
  }

  /** Execution of the subscriber's own actions only: other members' downloads stay private. */
  @Get('progress')
  async getProgress(@Req() req: Request): Promise<Record<string, ExecutionView>> {
    const userId = (req as Request & Record<string, string>)[USER_REQUEST_KEY];
    const requests = await this.requestsRepository.listByUserWithDetails(userId);
    const actions = await this.actionsOf(requests);
    return executionByTrack(actions, this.fetchr.liveDownloads(), await this.downloadJobs.listInProgress());
  }

  /** The admin read model, restricted to what this subscriber requested. */
  private async dashboardOf(userId: string): Promise<Dashboard> {
    const requests = await this.requestsRepository.listByUserWithDetails(userId);
    const [states, actions, jobs, findings, lastPassAt] = await Promise.all([
      this.requestStates.listAll(),
      this.actionsOf(requests),
      this.downloadJobs.listInProgress(),
      this.findings.listAll(),
      this.requestStates.latestPlannedAt(),
    ]);
    return buildDashboard({
      requests,
      states,
      actions,
      jobs,
      findings,
      prefs: this.contextService.indexerPreferences,
      lastPassAt,
      bookmarks: [],
      tickets: [],
      downloads: this.fetchr.liveDownloads(),
    });
  }

  private async actionsOf(requests: RequestEntity[]): Promise<PlannedDownloadEntity[]> {
    const mediaIds = new Set(requests.map((r) => r.mediaId));
    const imdbIds = new Set(requests.map((r) => r.media?.imdbId));
    return (await this.plannedDownloads.listLive()).filter(
      (action) =>
        (action.showImdbId !== null && imdbIds.has(action.showImdbId)) ||
        action.coveredMediaIds.some((id) => mediaIds.has(id)),
    );
  }

  private userAgent(req: Request): string | null {
    return req.headers['user-agent'] ?? null;
  }

  private openSession(res: Response, token: string): void {
    res.clearCookie(USER_LOGIN_COOKIE, this.userAuth.loginCookieOptions);
    res.cookie(USER_SESSION_COOKIE, token, this.userAuth.cookieOptions);
    res.redirect(USER_SPACE_PATH);
  }
}
