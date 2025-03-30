import * as nodemailer from 'nodemailer';

import { AuthDevicePublicCtxt } from '@/modules/trakt/types';
import { MediaRequestEntity } from '@/services/database/mediaRequests';
import {
  errorTemplate,
  welcomeTemplate,
  registeredTemplate,
  traktLinkTemplate,
  mediaUpdateTemplate,
} from '@/templates/email';

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
      subject: 'Error - TraktSync',
      text: message,
      html: errorTemplate(message),
    });
  }

  async welcome(email: string): Promise<void> {
    await this.transporter.sendMail({
      to: email,
      subject: 'Welcome to TraktSync',
      text: 'Welcome to TraktSync!',
      html: welcomeTemplate(),
    });
  }

  async registered(email: string): Promise<void> {
    await this.transporter.sendMail({
      to: email,
      subject: 'Registration Completed - TraktSync',
      text: 'Registration completed successfully!',
      html: registeredTemplate(),
    });
  }

  async traktLinkRequest(email: string, authCtxt: AuthDevicePublicCtxt): Promise<void> {
    const url = `${authCtxt.verification_url}/${authCtxt.user_code}`;
    await this.transporter.sendMail({
      to: email,
      subject: 'Link Your Trakt Account - TraktSync',
      text: `Please link your Trakt account: ${url}`,
      html: traktLinkTemplate(url),
    });
  }

  async mediaRequestUpdated(email: string, request: MediaRequestEntity): Promise<void> {
    await this.transporter.sendMail({
      to: email,
      subject: `Media Update: ${request.title} - TraktSync`,
      text: `Media update: ${request.title} - Status: ${request.status}`,
      html: mediaUpdateTemplate(request),
    });
  }

  onJoin(): void {
    // Not applicable for email
    // TODO Read emails
  }

  onRegisterRequest(): void {
    // Not applicable for email
  }

  onTraktLinkRequest(): void {
    // Not applicable for email
  }
}
