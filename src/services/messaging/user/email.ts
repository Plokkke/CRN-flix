import * as nodemailer from 'nodemailer';

import { MediaRequestEntity, RequestStatus } from '@/services/database/mediaRequests';
import {
  errorTemplate,
  mediaUpdateTemplate,
  registeredTemplate
} from '@/templates/email';

import { JellyfinUser } from '@/modules/jellyfin/jellyfin';
import { UserMessaging } from '.';
import { z } from 'zod';
import { Logger } from '@nestjs/common';

export const configSchema = z.object({
  host: z.string(),
  port: z.number(),
  user: z.string(),
  pass: z.string(),
  from: z.string(),
});

export type Config = z.infer<typeof configSchema>;

const ALLOWED_STATUS_UPDATE: RequestStatus[] = ['fulfilled', 'missing', 'rejected'];

export class EmailUserMessaging extends UserMessaging<string> {
  private static logger = new Logger(EmailUserMessaging.name);
  private transporter: nodemailer.Transporter;

  constructor(private config: Config) {
    super();

    this.transporter = nodemailer.createTransport({
      host: this.config.host,
      port: this.config.port,
      requireTLS: true,
      auth: {
        user: this.config.user,
        pass: this.config.pass,
      },
      from: this.config.from,
    });
  }

  async error(email: string, message: string): Promise<void> {
    EmailUserMessaging.logger.debug(`Sending email to ${email} for error`);
    await this.transporter.sendMail({
      from: this.config.from,
      to: email,
      ...errorTemplate(message),
    });
  }

  async registered(email: string, jellyfinUser: JellyfinUser): Promise<void> {
    EmailUserMessaging.logger.debug(`Sending email to ${email} for registered user`);
    await this.transporter.sendMail({
      from: this.config.from,
      to: email,
      ...registeredTemplate(jellyfinUser),
    });
  }

  async mediaRequestUpdated(email: string, request: MediaRequestEntity): Promise<void> {
    if (!ALLOWED_STATUS_UPDATE.includes(request.status)) {
      EmailUserMessaging.logger.debug(`Skipping email to ${email} for media request update`);
      return;
    }

    EmailUserMessaging.logger.debug(`Sending email to ${email} for media request update`);
    await this.transporter.sendMail({
      from: this.config.from,
      to: email,
      ...mediaUpdateTemplate(request),
    });
  }
}
