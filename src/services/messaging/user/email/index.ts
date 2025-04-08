import { Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import { z } from 'zod';

import { ContextService } from '@/services/context';
import { MediaRequestEntity, RequestStatus } from '@/services/database/mediaRequests';
import { UserEntity } from '@/services/database/users';
import { UserMessaging } from '@/services/messaging/user';
import { errorTemplate, mediaUpdateTemplate, registeredTemplate } from '@/services/messaging/user/email/templates';

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

  constructor(
    private readonly config: Config,
    private readonly contextService: ContextService,
  ) {
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

  async registered(email: string, user: UserEntity, password: string): Promise<void> {
    EmailUserMessaging.logger.debug(`Sending email to ${email} for registered user`);
    const { subject, text, html } = await registeredTemplate({
      serviceName: this.contextService.name,
      mediaServerUrl: this.contextService.mediaServerUrl,
      userGuideUrl: this.contextService.userGuideUrl,
      traktLinkUrl: this.contextService.getTraktLinkUrl(user.id),
      userName: user.name,
      password,
      movies: await this.contextService.getRandomMedias(5, 'movie'),
      series: await this.contextService.getRandomMedias(5, 'show'),
    });
    await this.transporter.sendMail({
      from: this.config.from,
      to: email,
      subject,
      text,
      html,
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
