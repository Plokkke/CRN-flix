import { environmentVariablesSchema } from '@/environment';

jest.mock('@/services/logger', () => ({ logger: { debug: jest.fn() } }));

/** Fictional values: only the admin channel variables matter here. */
const BASE = {
  SERVER_URL: 'http://localhost:3000',
  PORT: '3000',
  SERVICE_NAME: 'CRN-Flix (local)',
  TRAKT_HOST: 'https://api.trakt.tv',
  TRAKT_CLIENT_ID: 'x',
  TRAKT_CLIENT_SECRET: 'x',
  JELLYFIN_URL: 'http://localhost:8096',
  DISCORD_ADMIN_IDS: 'local-admin',
  USER_MESSAGING: 'dry-run',
  DATABASE_HOST: 'localhost',
  DATABASE_PORT: '55432',
  DATABASE_NAME: 'crn_flix',
  DATABASE_USERNAME: 'crn_flix',
  DATABASE_PASSWORD: 'x',
  FETCHR_URL: 'ws://localhost:1',
  TMDB_API_KEY: 'x',
  DOWNLOADS_PATH: '/tmp/downloads',
  MEDIAS_PATH: '/tmp/medias',
};

const GMAIL = { GMAIL_USER: 'x', GMAIL_PASSWORD: 'x' };

describe('environment: user messaging', () => {
  const nodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = nodeEnv;
  });

  const discord = { DISCORD_CHANNEL_ID: 'c', DISCORD_BOT_TOKEN: 't' };

  it('needs the Gmail credentials only without a local outbox', () => {
    expect(environmentVariablesSchema.safeParse({ ...BASE, ...discord }).success).toBe(false);
    const sandbox = environmentVariablesSchema.parse({ ...BASE, ...discord, USER_MESSAGING_OUTBOX: '/tmp/outbox' });
    expect(sandbox.mailing.outbox).toBe('/tmp/outbox');
    expect(environmentVariablesSchema.parse({ ...BASE, ...discord, ...GMAIL }).mailing.outbox).toBeNull();
  });

  it('refuses the outbox in production: nobody would receive anything', () => {
    process.env.NODE_ENV = 'production';

    const result = environmentVariablesSchema.safeParse({ ...BASE, ...discord, USER_MESSAGING_OUTBOX: '/tmp/outbox' });

    expect(result.error?.issues[0].message).toMatch(/refused in production/);
  });
});

describe('environment: admin channel', () => {
  const nodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = nodeEnv;
  });

  it('needs the Discord credentials only with the Discord channel', () => {
    expect(environmentVariablesSchema.safeParse({ ...BASE, ...GMAIL }).success).toBe(false);
    expect(
      environmentVariablesSchema.safeParse({ ...BASE, ...GMAIL, DISCORD_CHANNEL_ID: 'c', DISCORD_BOT_TOKEN: 't' })
        .success,
    ).toBe(true);
    expect(environmentVariablesSchema.parse({ ...BASE, ...GMAIL, ADMIN_CHANNEL: 'console' }).adminChannel).toBe(
      'console',
    );
  });

  it('refuses the console channel in production: it prints the login codes', () => {
    process.env.NODE_ENV = 'production';

    const result = environmentVariablesSchema.safeParse({ ...BASE, ...GMAIL, ADMIN_CHANNEL: 'console' });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0].message).toMatch(/refused in production/);
  });
});

describe('environment: catalog', () => {
  const nodeEnv = process.env.NODE_ENV;
  const valid = { ...BASE, ...GMAIL, DISCORD_CHANNEL_ID: 'c', DISCORD_BOT_TOKEN: 't' };

  afterEach(() => {
    process.env.NODE_ENV = nodeEnv;
  });

  it('reads Trakt by default, and a file only when one is given', () => {
    expect(environmentVariablesSchema.parse(valid).catalog).toEqual({ kind: 'trakt' });
    expect(environmentVariablesSchema.safeParse({ ...valid, CATALOG: 'file' }).success).toBe(false);
    expect(
      environmentVariablesSchema.parse({ ...valid, CATALOG: 'file', CATALOG_FILE: '/tmp/c.json' }).catalog,
    ).toEqual({
      kind: 'file',
      file: '/tmp/c.json',
    });
  });

  it('refuses the file catalog in production: it would replace every user’s requests', () => {
    process.env.NODE_ENV = 'production';

    const result = environmentVariablesSchema.safeParse({ ...valid, CATALOG: 'file', CATALOG_FILE: '/tmp/c.json' });

    expect(result.error?.issues[0].message).toMatch(/refused in production/);
  });
});

describe('environment: downloader', () => {
  const nodeEnv = process.env.NODE_ENV;
  const valid = { ...BASE, ...GMAIL, DISCORD_CHANNEL_ID: 'c', DISCORD_BOT_TOKEN: 't' };

  afterEach(() => {
    process.env.NODE_ENV = nodeEnv;
  });

  it('uses Fetchr by default, and the fake one only with a sample to copy', () => {
    expect(environmentVariablesSchema.parse(valid).downloader).toEqual({ kind: 'fetchr' });
    expect(environmentVariablesSchema.safeParse({ ...valid, FETCHR_URL: '' }).success).toBe(false);
    expect(environmentVariablesSchema.safeParse({ ...valid, DOWNLOADER: 'fake' }).success).toBe(false);
    expect(
      environmentVariablesSchema.parse({
        ...valid,
        FETCHR_URL: '',
        DOWNLOADER: 'fake',
        FAKE_DOWNLOADER_SAMPLE: '/s.mkv',
      }).downloader,
    ).toEqual({ kind: 'fake', samplePath: '/s.mkv', durationMs: 10_000 });
  });

  it('refuses the fake downloader in production: nothing would ever be downloaded', () => {
    process.env.NODE_ENV = 'production';

    const result = environmentVariablesSchema.safeParse({
      ...valid,
      DOWNLOADER: 'fake',
      FAKE_DOWNLOADER_SAMPLE: '/s.mkv',
    });

    expect(result.error?.issues[0].message).toMatch(/refused in production/);
  });
});
