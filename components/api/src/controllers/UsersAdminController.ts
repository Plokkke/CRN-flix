import { Body, Controller, Get, Header, Param, Post, Query, Res, UseFilters, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { z } from 'zod';

import { SessionAuthRedirectFilter } from '@/filters/session-auth-redirect.filter';
import { AdminSessionGuard } from '@/guards/admin-session.guard';
import { ContextService } from '@/services/context';
import { UsersRepository, UserStatus } from '@/services/database/users';
import { PlayerAccountsService } from '@/services/player-accounts';
import { adminUsersTemplate } from '@/web/templates/admin-users';

const maxStreamsFormSchema = z.object({ maxStreams: z.coerce.number().int().min(0) });

@Controller('admin/users')
@UseGuards(AdminSessionGuard)
@UseFilters(SessionAuthRedirectFilter)
export class UsersAdminController {
  constructor(
    private readonly contextService: ContextService,
    private readonly usersRepository: UsersRepository,
    private readonly playerAccounts: PlayerAccountsService,
  ) {}

  @Get()
  @Header('content-type', 'text/html')
  async list(@Query('message') message?: string): Promise<string> {
    const users = (await this.usersRepository.list())
      .filter((user) => user.status === UserStatus.Active)
      .sort((a, b) => a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' }));
    return adminUsersTemplate({ serviceName: this.contextService.name, users, flashMessage: message });
  }

  /** Saved first, then applied: a player refusal is caught up by the hourly account-policy pass. */
  @Post(':id/max-streams')
  async setMaxStreams(@Param('id') id: string, @Body() body: unknown, @Res() res: Response): Promise<void> {
    const { maxStreams } = maxStreamsFormSchema.parse(body);
    const user = await this.usersRepository.get(id);
    if (!user) {
      res.redirect('/admin/users?message=Utilisateur introuvable');
      return;
    }
    await this.usersRepository.setMaxStreams(id, maxStreams);
    const outcome = await this.playerAccounts
      .apply({ ...user, maxStreams })
      .then(() => 'appliqué')
      .catch(() => 'enregistré, appliqué au prochain passage');
    res.redirect(`/admin/users?message=${encodeURIComponent(`${user.name} : ${maxStreams} flux (${outcome})`)}`);
  }
}
