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
  GMAIL_USER: 'x',
  GMAIL_PASSWORD: 'x',
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

describe('environment: admin channel', () => {
  const nodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = nodeEnv;
  });

  it('needs the Discord credentials only with the Discord channel', () => {
    expect(environmentVariablesSchema.safeParse(BASE).success).toBe(false);
    expect(
      environmentVariablesSchema.safeParse({ ...BASE, DISCORD_CHANNEL_ID: 'c', DISCORD_BOT_TOKEN: 't' }).success,
    ).toBe(true);
    expect(environmentVariablesSchema.parse({ ...BASE, ADMIN_CHANNEL: 'console' }).adminChannel).toBe('console');
  });

  it('refuses the console channel in production: it prints the login codes', () => {
    process.env.NODE_ENV = 'production';

    const result = environmentVariablesSchema.safeParse({ ...BASE, ADMIN_CHANNEL: 'console' });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0].message).toMatch(/refused in production/);
  });
});
