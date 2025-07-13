import { Body, Controller, Get, Header, Param, Post, Res } from '@nestjs/common';
import { Response } from 'express';
import { z } from 'zod';

import { TraktPlugin } from '@/modules/jellyfin/plugins/trakt';
import { TraktApi } from '@/modules/trakt/api';
import { ContextService } from '@/services/context';
import { UsersRepository } from '@/services/database/users';
import { DiscordAdminMessaging } from '@/services/messaging/admin/discord';
import { registrationFormTemplate } from '@/services/messaging/user/email/templates';

const registrationSchema = z.object({
  email: z.string().email('Email invalide'),
  username: z.string().min(3, 'Le pseudo doit contenir au moins 3 caractères'),
});

type RegistrationForm = z.infer<typeof registrationSchema>;

@Controller('users')
export class UsersController {
  constructor(
    private readonly contextService: ContextService,
    private readonly usersRepository: UsersRepository,
    private readonly discordAdminMessaging: DiscordAdminMessaging,
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
  async handleRegistration(@Body() body: RegistrationForm): Promise<{ success: boolean; message: string }> {
    try {
      const validatedData = registrationSchema.parse(body);

      const user = await this.usersRepository.createFromMessagingInfos(
        'email',
        validatedData.email,
        validatedData.username,
      );

      await this.discordAdminMessaging.newRegistrationRequest(user);

      return { success: true, message: "Votre demande d'inscription a été envoyée avec succès." };
    } catch (error) {
      if (error instanceof z.ZodError) {
        return { success: false, message: 'Données invalides' };
      }
      throw error;
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
        await this.traktPlugin.setConfig(user.jellyfinId!, authCtxt.accessToken);
      }
    });

    res.redirect(url);
  }
}
