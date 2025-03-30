import { Body, Controller, Get, Header, Post } from '@nestjs/common';
import { z } from 'zod';

import { MediaRequestsRepository } from '@/services/database/mediaRequests';
import { UsersRepository } from '@/services/database/users';
import { DiscordAdminMessaging } from '@/services/messaging/admin/discord';

const registrationSchema = z.object({
  email: z.string().email('Email invalide'),
  username: z.string().min(3, 'Le pseudo doit contenir au moins 3 caractères'),
});

type RegistrationForm = z.infer<typeof registrationSchema>;

@Controller('register-form')
export class RegistrationController {
  constructor(
    private readonly usersRepository: UsersRepository,
    private readonly discordAdminMessaging: DiscordAdminMessaging,
    private readonly mediaRequestRepository: MediaRequestsRepository,
  ) {}

  @Get()
  @Header('content-type', 'text/html')
  getRegistrationForm(): string {
    return `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Inscription</title>
          <style>
            body {
              font-family: Arial, sans-serif;
              max-width: 600px;
              margin: 0 auto;
              padding: 20px;
            }
            .form-group {
              margin-bottom: 15px;
            }
            label {
              display: block;
              margin-bottom: 5px;
            }
            input {
              width: 100%;
              padding: 8px;
              border: 1px solid #ddd;
              border-radius: 4px;
            }
            button {
              background-color: #4CAF50;
              color: white;
              padding: 10px 15px;
              border: none;
              border-radius: 4px;
              cursor: pointer;
            }
            button:hover {
              background-color: #45a049;
            }
          </style>
        </head>
        <body>
          <h1>Inscription</h1>
          <form method="POST" action="/register-form">
            <div class="form-group">
              <label for="email">Email:</label>
              <input type="email" id="email" name="email" required>
            </div>
            <div class="form-group">
              <label for="username">Pseudo:</label>
              <input type="text" id="username" name="username" required>
            </div>
            <button type="submit">S'inscrire</button>
          </form>
        </body>
      </html>
    `;
  }

  @Post()
  async handleRegistration(@Body() body: RegistrationForm): Promise<{ success: boolean; message: string }> {
    try {
      const validatedData = registrationSchema.parse(body);

      const user = await this.usersRepository.upsert({
        name: validatedData.username,
        messagingKey: 'email',
        messagingId: validatedData.email,
        jellyfinId: null,
      });

      await this.discordAdminMessaging.newRegistrationRequest(user);

      return { success: true, message: "Votre demande d'inscription a été envoyée avec succès." };
    } catch (error) {
      if (error instanceof z.ZodError) {
        return { success: false, message: 'Données invalides' };
      }
      throw error;
    }
  }
}
