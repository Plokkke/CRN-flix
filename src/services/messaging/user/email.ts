import * as nodemailer from 'nodemailer';

import { MediaRequestEntity } from '@/services/database/mediaRequests';
import {
  errorTemplate,
  mediaUpdateTemplate,
  registeredTemplate
} from '@/templates/email';

import { JellyfinUser } from '@/modules/jellyfin/jellyfin';
import { UserMessaging } from '.';

export class EmailUserMessaging extends UserMessaging<string> {
  private transporter: nodemailer.Transporter;

  constructor() {
    super();

    this.transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT),
      secure: true,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });
  }

  async error(email: string, message: string): Promise<void> {
    await this.transporter.sendMail({
      to: email,
      subject: 'Erreur - TraktSync',
      text: message,
      html: errorTemplate(message),
    });
  }

  async registered(email: string, jellyfinUser: JellyfinUser): Promise<void> {
    await this.transporter.sendMail({
      to: email,
      subject: 'Inscription Complétée',
      ...registeredTemplate(jellyfinUser),
    });
  }

  async mediaRequestUpdated(email: string, request: MediaRequestEntity): Promise<void> {
    await this.transporter.sendMail({
      to: email,
      subject: `Mise à jour de la demande: ${request.title} - TraktSync`,
      ...mediaUpdateTemplate(request),
    });
  }
}
