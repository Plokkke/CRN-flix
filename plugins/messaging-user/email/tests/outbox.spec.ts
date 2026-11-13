import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

import { EmailChannel, OutboxSender } from '../src';

const identity = {
  serviceName: 'CRN-Flix (local)',
  playerUrl: 'http://localhost:8096',
  userSpaceUrl: 'http://localhost:3000/me',
};

describe('EmailChannel with a local outbox', () => {
  let folder: string;

  beforeEach(async () => {
    folder = await fs.mkdtemp(path.join(os.tmpdir(), 'crn-flix-outbox-'));
  });

  afterEach(() => fs.rm(folder, { recursive: true, force: true }));

  it('writes the very email it would send, as html and text, with the login code readable', async () => {
    const channel = new EmailChannel(
      { serviceName: 'CRN-Flix (local)', gmailUser: '', gmailPassword: '', outbox: folder },
      identity,
    );
    await channel.verify();

    await channel.loginChallenge(
      { name: 'Léo', address: 'leo@example.invalid' },
      {
        code: '123456',
        link: 'http://localhost:3000/me/login/link?token=t',
        serviceName: 'CRN-Flix (local)',
        expiresInMinutes: 10,
      },
    );

    const files = (await fs.readdir(folder)).sort();
    expect(files).toHaveLength(2);
    expect(files[0]).toMatch(/leo@example\.invalid-.*\.html$/);
    const text = await fs.readFile(path.join(folder, files[1]), 'utf8');
    expect(text).toContain('To: leo@example.invalid');
    expect(text).toContain('123456');
  });

  it('names files by time so they sort in sending order', async () => {
    const sender = new OutboxSender(folder, () => new Date('2026-11-13T19:00:00.000Z'));

    await sender.send({ from: 'a', to: 'b@x', subject: 'Sujet', html: '<p>h</p>', text: 't' });

    expect(await fs.readdir(folder)).toContain('2026-11-13T19-00-00-000Z-b@x-Sujet.html');
  });
});
