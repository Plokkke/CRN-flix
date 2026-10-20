import { Body, Controller, Get, Header, Logger, Param, Post, Res } from '@nestjs/common';
import { Response } from 'express';
import { z } from 'zod';

import { TraktApi } from '@crn-flix/catalog-trakt';
import { TraktPlugin } from '@crn-flix/player-jellyfin';

import { ContextService } from '@/services/context';
import { UsersRepository } from '@/services/database/users';
import { TicketCategory } from '@/services/tickets/model';
import { TicketService } from '@/services/tickets/ticket.service';
import { registrationFormTemplate } from '@/web/templates/registration-form';
import { RegistrationOutcome, registrationResultTemplate } from '@/web/templates/registration-result';

const registrationSchema = z.object({
  email: z.email('Email invalide'),
  username: z.string().min(3, 'Le pseudo doit contenir au moins 3 caractères'),
});

type RegistrationForm = z.infer<typeof registrationSchema>;

const REGISTRATION_FORM_URL = '/users/form';

const describeError = (error: unknown): string => (error instanceof Error ? error.message : String(error));

@Controller('users')
export class UsersController {
  private static readonly logger = new Logger(UsersController.name);

  constructor(
    private readonly contextService: ContextService,
    private readonly usersRepository: UsersRepository,
    private readonly ticketService: TicketService,
    private readonly trakt: TraktApi,
    private readonly traktPlugin: TraktPlugin,
  ) {}

  @Get('form')
  @Header('content-type', 'text/html')
  getRegistrationForm(): string {
    return registrationFormTemplate({
      serviceName: this.contextService.name,
      formAction: '/users',
    });
  }

  @Post()
  @Header('content-type', 'text/html')
  async handleRegistration(@Body() body: RegistrationForm): Promise<string> {
    return registrationResultTemplate({
      serviceName: this.contextService.name,
      formUrl: REGISTRATION_FORM_URL,
      outcome: await this.register(body),
    });
  }

  private async register(body: unknown): Promise<RegistrationOutcome> {
    const parsed = registrationSchema.safeParse(body);
    if (!parsed.success) {
      return { succeeded: false, reason: parsed.error.issues.map((issue) => issue.message).join('. ') };
    }
    if (await this.usersRepository.existsByName(parsed.data.username)) {
      return { succeeded: false, reason: 'Ce pseudo est déjà utilisé, merci d’en choisir un autre.' };
    }
    try {
      const user = await this.usersRepository.createFromMessagingInfos(
        'email',
        parsed.data.email,
        parsed.data.username,
      );
      await this.ticketService.open(
        TicketCategory.UserApproval,
        { type: 'user', id: user.id },
        { userId: user.id },
        { title: `Nouvelle demande d'inscription: ${user.name}` },
      );
      return { succeeded: true };
    } catch (error) {
      UsersController.logger.error(`Registration of ${parsed.data.username} failed: ${describeError(error)}`);
      return { succeeded: false, reason: 'Une erreur est survenue de notre côté. Merci de réessayer plus tard.' };
    }
  }

  @Get(':id/trakt-link')
  async getTraktLink(@Param('id') id: string, @Res() res: Response): Promise<void> {
    const user = await this.usersRepository.get(id);
    if (!user) {
      throw new Error('User not found');
    }
    if (!user.jellyfinId) {
      throw new Error('User not registered to Jellyfin');
    }

    const url = await new Promise<string>(async (resolve) => {
      const authCtxt = await this.trakt
        .authorizeDevice(async (authDeviceCtxt) =>
          resolve(`${authDeviceCtxt.verification_url}/${authDeviceCtxt.user_code}`),
        )
        .catch(() => null);
      if (authCtxt) {
        await this.traktPlugin.setConfig(user.jellyfinId!, {
          accessToken: authCtxt.accessToken,
          refreshToken: authCtxt.refreshToken,
          accessTokenExpiration: authCtxt.accessTokenExpiration,
        });
      }
    });

    res.redirect(url);
  }
}
