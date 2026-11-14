import { Body, Controller, Get, Header, Param, Post, Query, Req, Res, UseFilters, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request, Response } from 'express';
import { z } from 'zod';

import { Config } from '@/app.module';
import { SessionAuthRedirectFilter } from '@/filters/session-auth-redirect.filter';
import { AdminSessionGuard } from '@/guards/admin-session.guard';
import { ContextService } from '@/services/context';
import { UsersRepository, UserStatus } from '@/services/database/users';
import { LibraryShelves } from '@/services/library/shelves';
import { PlayerAccountsService } from '@/services/player-accounts';
import { PROFILES } from '@/services/policy/shelves';
import { adminUsersTemplate, PROFILE_LABELS } from '@/web/templates/admin-users';

const maxStreamsFormSchema = z.object({ maxStreams: z.coerce.number().int().min(0) });
const profileFormSchema = z.object({ profile: z.enum(PROFILES) });

/** A live form (JSON) gets the message; a plain form goes back to the page with it. */
function answer(req: Request, res: Response, message: string, error = false, reload = false): void {
  if (String(req.headers.accept ?? '').includes('application/json')) {
    res.status(error ? 400 : 200).json({ message, error, reload });
    return;
  }
  res.redirect(`/admin/users?message=${encodeURIComponent(message)}`);
}

const adminOf = (req: Request): string | null => (req as Request & { adminUserId?: string }).adminUserId ?? null;

@Controller('admin/users')
@UseGuards(AdminSessionGuard)
@UseFilters(SessionAuthRedirectFilter)
export class UsersAdminController {
  constructor(
    private readonly config: ConfigService<Config, true>,
    private readonly contextService: ContextService,
    private readonly usersRepository: UsersRepository,
    private readonly playerAccounts: PlayerAccountsService,
    private readonly shelves: LibraryShelves,
  ) {}

  @Get()
  @Header('content-type', 'text/html')
  async list(@Req() req: Request, @Query('message') message?: string): Promise<string> {
    const adopted = await this.playerAccounts.adoptUnknown().catch(() => []);
    adopted.forEach((user) => void this.playerAccounts.apply(user).catch(() => undefined));
    const users = (await this.usersRepository.list())
      .filter((user) => user.status === UserStatus.Active)
      .sort((a, b) => Number(a.guest) - Number(b.guest) || a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' }));
    return adminUsersTemplate({
      serviceName: this.contextService.name,
      users,
      adminIds: this.adminIds,
      currentAdminId: adminOf(req),
      flashMessage: message,
    });
  }

  /** A guest sees the shelves of its profile and never has a personal shelf; it is listed last. */
  @Post(':id/guest')
  async setGuest(
    @Param('id') id: string,
    @Body('guest') guest: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const user = await this.usersRepository.get(id);
    if (!user) {
      answer(req, res, 'Utilisateur introuvable', true);
      return;
    }
    const isGuest = guest === 'on';
    await this.usersRepository.setGuest(id, isGuest);
    await this.shelves.reconcile().catch(() => undefined);
    await this.playerAccounts.apply({ ...user, guest: isGuest }).catch(() => undefined);
    answer(req, res, `${user.name} : ${isGuest ? 'invité, sans étagère personnelle' : 'abonné'}`, false, true);
  }

  /** The Discord admin this account belongs to; an admin has one account, the previous one is let go. */
  @Post(':id/admin')
  async setAdmin(
    @Param('id') id: string,
    @Body('adminId') adminId: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const user = await this.usersRepository.get(id);
    const wanted = adminId ? adminId : null;
    if (!user || (wanted !== null && !this.adminIds.includes(wanted))) {
      answer(req, res, user ? 'Admin inconnu' : 'Utilisateur introuvable', true);
      return;
    }
    await this.usersRepository.setAdminDiscordId(id, wanted);
    answer(
      req,
      res,
      wanted ? `${user.name} : compte de l’admin ${wanted}` : `${user.name} : plus lié à un admin`,
      false,
      wanted !== null,
    );
  }

  private get adminIds(): string[] {
    return this.config.get('administration').adminIds;
  }

  /** Saved first, then applied: a player refusal is caught up by the next player-sync. */
  @Post(':id/max-streams')
  async setMaxStreams(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const form = maxStreamsFormSchema.safeParse(body);
    const user = await this.usersRepository.get(id);
    if (!form.success || !user) {
      answer(req, res, user ? 'Nombre de flux invalide' : 'Utilisateur introuvable', true);
      return;
    }
    const { maxStreams } = form.data;
    await this.usersRepository.setMaxStreams(id, maxStreams);
    const outcome = await this.playerAccounts
      .apply({ ...user, maxStreams })
      .then(() => 'appliqué')
      .catch(() => 'enregistré, appliqué au prochain passage');
    answer(req, res, `${user.name} : ${maxStreams === 0 ? 'flux illimités' : `${maxStreams} flux`} (${outcome})`);
  }

  /** The profile decides the shelves the account sees; the planner applies it to requests on its next pass. */
  @Post(':id/profile')
  async setProfile(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const form = profileFormSchema.safeParse(body);
    const user = await this.usersRepository.get(id);
    if (!form.success || !user) {
      answer(req, res, user ? 'Profil inconnu' : 'Utilisateur introuvable', true);
      return;
    }
    const { profile } = form.data;
    await this.usersRepository.setProfile(id, profile);
    await this.shelves.reconcile().catch(() => undefined);
    const outcome = await this.playerAccounts
      .apply({ ...user, profile })
      .then(() => 'appliqué')
      .catch(() => 'enregistré, appliqué au prochain passage');
    answer(req, res, `${user.name} : profil ${PROFILE_LABELS[profile]} (${outcome})`);
  }
}
