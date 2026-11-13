import { z } from 'zod';

import {
  CatalogRelink,
  createLogger,
  LoginChallenge,
  Recipient,
  RequestNotice,
  ServiceIdentity,
  ServiceNotice,
  UserChannel,
  Welcome,
} from '@crn-flix/contracts';

import { GmailSender, MailSender, OutboxSender } from './senders';
import {
  catalogRelinkTemplate,
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
  /** Local sandbox: emails are written to this folder instead of being sent. */
  outbox: z.string().nullable().default(null),
});

/** The outbox is optional: without it, emails go through SMTP. */
export type EmailConfig = z.input<typeof emailConfigSchema>;

type Rendered = { subject: string; html: string; text: string };

/**
 * Sends through Gmail's SMTP (or into a local outbox in the sandbox);
 * `users.messaging_key = 'email'`, the address is the messaging id.
 */
export class EmailChannel implements UserChannel {
  private static readonly logger = createLogger(EmailChannel.name);

  readonly kind = 'email';

  private readonly sender: MailSender;

  constructor(
    private readonly config: EmailConfig,
    private readonly identity: ServiceIdentity,
    sender?: MailSender,
  ) {
    this.sender =
      sender ??
      (config.outbox ? new OutboxSender(config.outbox) : new GmailSender(config.gmailUser, config.gmailPassword));
    EmailChannel.logger.log(`Email transport: ${this.sender.description}`);
  }

  async verify(): Promise<void> {
    await this.sender.verify();
  }

  error(to: Recipient, message: string): Promise<void> {
    return this.send(to, 'error', errorTemplate(message));
  }

  async welcome(to: Recipient, welcome: Welcome): Promise<void> {
    const rendered = registeredTemplate({
      serviceName: this.identity.serviceName,
      playerUrl: this.identity.playerUrl,
      userSpaceUrl: this.identity.userSpaceUrl,
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

  catalogRelink(to: Recipient, relink: CatalogRelink): Promise<void> {
    return this.send(to, 'catalog relink', catalogRelinkTemplate(this.identity.serviceName, to.name, relink));
  }

  private async send(to: Recipient, purpose: string, rendered: Rendered): Promise<void> {
    try {
      await this.sender.send({
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
