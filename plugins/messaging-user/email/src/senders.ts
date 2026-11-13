import * as fs from 'fs/promises';
import * as path from 'path';

import * as nodemailer from 'nodemailer';

/** A rendered email, ready to leave. */
export type Mail = { from: string; to: string; subject: string; html: string; text: string };

/** How a rendered email leaves: through SMTP, or into a local folder (sandbox). */
export interface MailSender {
  readonly description: string;
  verify(): Promise<void>;
  send(mail: Mail): Promise<void>;
}

/** Nodemailer waits 2 minutes by default before giving up on an unresponsive server. */
const SMTP_TIMEOUT_MS = 15_000;

export class GmailSender implements MailSender {
  readonly description: string;

  private readonly transporter: nodemailer.Transporter;

  constructor(user: string, password: string) {
    this.description = `Gmail SMTP (user: ${user})`;
    this.transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user, pass: password },
      connectionTimeout: SMTP_TIMEOUT_MS,
      greetingTimeout: SMTP_TIMEOUT_MS,
      socketTimeout: SMTP_TIMEOUT_MS,
    });
  }

  async verify(): Promise<void> {
    await this.transporter.verify();
  }

  async send(mail: Mail): Promise<void> {
    await this.transporter.sendMail(mail);
  }
}

const slug = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/[^\w@.-]+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 60);

/**
 * Writes every email as an `.html` file (open it in a browser: links and login codes work)
 * plus a `.txt`, named by time, recipient and subject. Local sandbox only: nobody receives it.
 */
export class OutboxSender implements MailSender {
  readonly description: string;

  constructor(
    private readonly folder: string,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.description = `local outbox (${folder})`;
  }

  async verify(): Promise<void> {
    await fs.mkdir(this.folder, { recursive: true });
  }

  async send(mail: Mail): Promise<void> {
    const stamp = this.now().toISOString().replace(/[:.]/g, '-');
    const base = path.join(this.folder, `${stamp}-${slug(mail.to)}-${slug(mail.subject)}`);
    await fs.mkdir(this.folder, { recursive: true });
    await fs.writeFile(`${base}.html`, mail.html);
    await fs.writeFile(`${base}.txt`, `To: ${mail.to}\nSubject: ${mail.subject}\n\n${mail.text}\n`);
  }
}
