import * as nodemailer from 'nodemailer';

import { AuthDevicePublicCtxt } from '@/modules/trakt/types';

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
      subject: 'Error',
      text: message,
      html: `<h1>Error</h1><p>${message}</p>`,
    });
  }

  async welcome(email: string): Promise<void> {
    await this.transporter.sendMail({
      to: email,
      subject: 'Welcome to TraktSync',
      text: 'Welcome to TraktSync!',
      html: '<h1>Welcome to TraktSync!</h1>',
    });
  }

  async registered(email: string): Promise<void> {
    await this.transporter.sendMail({
      to: email,
      subject: 'Registration Completed',
      text: 'Registration completed successfully!',
      html: '<h1>Registration completed successfully!</h1>',
    });
  }

  async traktLinkRequest(email: string, authCtxt: AuthDevicePublicCtxt): Promise<void> {
    const url = `${authCtxt.verification_url}/${authCtxt.user_code}`;
    await this.transporter.sendMail({
      to: email,
      subject: 'Link Your Trakt Account',
      text: `Please link your Trakt account: ${url}`,
      html: `<h1>Link Your Trakt Account</h1><p>Please visit the following link to link your Trakt account: <a href="${url}">${url}</a></p>`,
    });
  }

  async mediaRequestUpdated(email: string, mediaTitle: string, status: string): Promise<void> {
    await this.transporter.sendMail({
      to: email,
      subject: `Media Update: ${mediaTitle}`,
      text: `Media update: ${mediaTitle} - Status: ${status}`,
      html: `<h1>Media Update</h1><p>${mediaTitle} - Status: ${status}</p>`,
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
