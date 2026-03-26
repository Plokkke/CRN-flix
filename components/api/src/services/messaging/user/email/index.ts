import { InternalServerErrorException, Logger, OnModuleDestroy } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import { z } from 'zod';

import { ContextService } from '@/services/context';
import { RequestEntity, RequestStatus } from '@/services/database/requests';
import { UserEntity } from '@/services/database/users';
import { UserMessaging } from '@/services/messaging/user';
import { errorTemplate, registeredTemplate, requestUpdateTemplate } from '@/services/messaging/user/email/templates';

import { EmailQueue } from './queue';

export const configSchema = z.object({
  serviceName: z.string(),
  gmailUser: z.string(),
  gmailPassword: z.string(),
});

export type Config = z.infer<typeof configSchema>;

const ALLOWED_STATUS_UPDATE: RequestStatus[] = [
  RequestStatus.Pending,
  RequestStatus.Fulfilled,
  RequestStatus.Missing,
  RequestStatus.Rejected,
];

export class EmailUserMessaging extends UserMessaging<string> implements OnModuleDestroy {
  private static logger = new Logger(EmailUserMessaging.name);
  private transporter: nodemailer.Transporter;
  private emailQueue: EmailQueue;

  constructor(
    private readonly config: Config,
    private readonly contextService: ContextService,
  ) {
    super();

    this.transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: this.config.gmailUser,
        pass: this.config.gmailPassword,
      },
    });

    this.emailQueue = new EmailQueue(this.sendRequestUpdateEmail.bind(this));
  }

  async onModuleDestroy(): Promise<void> {
    await this.emailQueue.onEmpty();
  }

  get from(): string {
    return `${this.config.serviceName} <${this.config.gmailUser}>`;
  }

  async error(email: string, message: string): Promise<void> {
    try {
      EmailUserMessaging.logger.debug(`Sending email to ${email} for error`);
      await this.transporter.sendMail({
        from: this.from,
        to: email,
        ...errorTemplate(message),
      });
      EmailUserMessaging.logger.log(`Error email sent successfully to ${email}`);
    } catch (error) {
      EmailUserMessaging.logger.error(`Failed to send error email to ${email}`, error);
      throw error;
    }
  }

  async registered(email: string, user: UserEntity, password: string): Promise<void> {
    try {
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
        from: this.from,
        to: email,
        subject,
        text,
        html,
      });
      EmailUserMessaging.logger.log(`Registration email sent successfully to ${email}`);
    } catch (error) {
      EmailUserMessaging.logger.error(`Failed to send registration email to ${email}`, error);
      throw error;
    }
  }

  async requestUpdated(email: string, request: RequestEntity): Promise<void> {
    if (!request.media) {
      throw new InternalServerErrorException('Request media not loaded');
    }
    if (!ALLOWED_STATUS_UPDATE.includes(request.status)) {
      EmailUserMessaging.logger.debug(`Skipping email to ${email} for media request update`);
      return;
    }

    EmailUserMessaging.logger.log(`Queueing email to ${email} for media request update`);
    await this.emailQueue.addToQueue(email, request);
  }

  private async sendRequestUpdateEmail(email: string, requests: RequestEntity[]): Promise<void> {
    try {
      EmailUserMessaging.logger.log(`Sending email to ${email} for media request update`);
      // await this.transporter.sendMail({
      //   from: this.from,
      //   to: email,
      //   ...requestUpdateTemplate({
      //     serviceName: this.contextService.name,
      //     mediaServerUrl: this.contextService.mediaServerUrl,
      //     requests,
      //     posterUrlByImdbId: {}, // TODO get jellyfin item
      //   }),
      // });
      console.log('--- Email content ---');
      console.log(
        JSON.stringify(
          requestUpdateTemplate({
            serviceName: this.contextService.name,
            mediaServerUrl: this.contextService.mediaServerUrl,
            requests,
            posterUrlByImdbId: {}, // TODO get jellyfin item
          }).text,
          null,
          2,
        ),
      );
      console.log('--- End of email content ---');
      EmailUserMessaging.logger.log(`Request update email sent successfully to ${email}`);
    } catch (error) {
      EmailUserMessaging.logger.error(`Failed to send request update email to ${email}`, error);
      throw error;
    }
  }
}
