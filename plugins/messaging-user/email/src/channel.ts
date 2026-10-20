import * as nodemailer from 'nodemailer';
import { z } from 'zod';

import {
  createLogger,
  LoginChallenge,
  Recipient,
  RequestNotice,
  ServiceIdentity,
  ServiceNotice,
  UserChannel,
  Welcome,
} from '@crn-flix/contracts';

import {
  errorTemplate,
  loginChallengeTemplate,
  registeredTemplate,
  requestUpdateTemplate,
  serviceNoticeTemplate,
} from './templates';

export const emailConfigSchema = z.object({
  serviceName: z.string(),
  gmailUser: z.string(),
  gmailPassword: z.string(),
});

export type EmailConfig = z.infer<typeof emailConfigSchema>;

type Rendered = { subject: string; html: string; text: string };

/** Nodemailer waits 2 minutes by default before giving up on an unresponsive server. */
const SMTP_TIMEOUT_MS = 15_000;

/** Sends through Gmail's SMTP; `users.messaging_key = 'email'`, the address is the messaging id. */
export class EmailChannel implements UserChannel {
  private static readonly logger = createLogger(EmailChannel.name);

  readonly kind = 'email';

  private readonly transporter: nodemailer.Transporter;

  constructor(
    private readonly config: EmailConfig,
    private readonly identity: ServiceIdentity,
  ) {
    EmailChannel.logger.log(`Configuring email transport (user: ${config.gmailUser})`);
    this.transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: config.gmailUser, pass: config.gmailPassword },
      connectionTimeout: SMTP_TIMEOUT_MS,
      greetingTimeout: SMTP_TIMEOUT_MS,
      socketTimeout: SMTP_TIMEOUT_MS,
    });
  }

  async verify(): Promise<void> {
    await this.transporter.verify();
  }

  error(to: Recipient, message: string): Promise<void> {
    return this.send(to, 'error', errorTemplate(message));
  }

  async welcome(to: Recipient, welcome: Welcome): Promise<void> {
    const rendered = registeredTemplate({
      serviceName: this.identity.serviceName,
      playerUrl: this.identity.playerUrl,
      userGuideUrl: welcome.userGuideUrl,
      catalogLinkUrl: welcome.catalogLinkUrl,
      userName: to.name,
      password: welcome.password,
      movies: welcome.showcase.movies,
      series: welcome.showcase.shows,
    });
    await this.send(to, 'welcome', rendered);
  }

  requestsUpdated(to: Recipient, notices: RequestNotice[]): Promise<void> {
    return this.send(to, 'request update', requestUpdateTemplate(this.identity, notices));
  }

  loginChallenge(to: Recipient, challenge: LoginChallenge): Promise<void> {
    return this.send(to, 'login challenge', loginChallengeTemplate(challenge));
  }

  announce(to: Recipient, notice: ServiceNotice): Promise<void> {
    return this.send(to, 'announcement', serviceNoticeTemplate(this.identity.serviceName, notice));
  }

  private async send(to: Recipient, purpose: string, rendered: Rendered): Promise<void> {
    try {
      await this.transporter.sendMail({
        from: `${this.config.serviceName} <${this.config.gmailUser}>`,
        to: to.address,
        ...rendered,
      });
      EmailChannel.logger.log(`${purpose} email sent to ${to.address}`);
    } catch (error) {
      EmailChannel.logger.error(
        `Failed to send ${purpose} email to ${to.address}: ${error instanceof Error ? error.message : error}`,
      );
      throw error;
    }
  }
}
