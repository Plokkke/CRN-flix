import { DiscordService } from '@/modules/discord/discord';
import { AdminAuthService } from '@/services/admin-auth';
import { MemoryCacheService } from '@/services/cache/memory-cache.service';
import { AdminSessionsRepository } from '@/services/database/admin-sessions';

const ADMIN_IDS = ['admin-1', 'admin-2'];

type Harness = {
  service: AdminAuthService;
  cache: MemoryCacheService;
  sentCodes: Map<string, string>;
  sessions: jest.Mocked<AdminSessionsRepository>;
  sendDirectMessage: jest.Mock;
};

function buildHarness(overrides: { secureCookies?: boolean } = {}): Harness {
  const sentCodes = new Map<string, string>();
  const sendDirectMessage = jest.fn(async (userId: string, content: string) => {
    sentCodes.set(userId, content.match(/\*\*(\d{6})\*\*/)![1]);
  });

  const sessions = {
    create: jest.fn(async () => undefined),
    getLive: jest.fn(async () => null),
    touch: jest.fn(async () => undefined),
    revoke: jest.fn(async () => undefined),
  } as unknown as jest.Mocked<AdminSessionsRepository>;

  const cache = new MemoryCacheService();
  const service = new AdminAuthService(
    { adminIds: ADMIN_IDS, serviceName: 'CRN-Flix', secureCookies: overrides.secureCookies ?? true },
    sessions,
    cache,
    { sendDirectMessage } as unknown as DiscordService,
  );

  return { service, cache, sentCodes, sessions, sendDirectMessage };
}

describe('AdminAuthService', () => {
  describe('requestCode', () => {
    it('DMs a distinct code to every admin', async () => {
      const { service, sentCodes } = buildHarness();

      await expect(service.requestCode()).resolves.toBe('sent');
      expect(sentCodes.size).toBe(2);
      expect(sentCodes.get('admin-1')).not.toBe(sentCodes.get('admin-2'));
    });

    it('throttles a second request within the cooldown', async () => {
      const { service, sendDirectMessage } = buildHarness();

      await service.requestCode();
      await expect(service.requestCode()).resolves.toBe('throttled');
      expect(sendDirectMessage).toHaveBeenCalledTimes(ADMIN_IDS.length);
    });

    it('reports a delivery failure and retains no code when no DM goes through', async () => {
      const { service, cache, sendDirectMessage } = buildHarness();
      sendDirectMessage.mockRejectedValue(new Error('blocked'));

      await expect(service.requestCode()).resolves.toBe('delivery-failed');
      await expect(service.verifyCode('000000', null)).resolves.toBeNull();
      await cache.flush();
    });

    it('keeps the codes that were delivered when one admin is unreachable', async () => {
      const { service, sentCodes, sendDirectMessage } = buildHarness();
      sendDirectMessage.mockImplementation(async (userId: string, content: string) => {
        if (userId === 'admin-1') {
          throw new Error('blocked');
        }
        sentCodes.set(userId, content.match(/\*\*(\d{6})\*\*/)![1]);
      });

      await expect(service.requestCode()).resolves.toBe('sent');
      await expect(service.verifyCode(sentCodes.get('admin-2')!, null)).resolves.toEqual(expect.any(String));
    });
  });

  describe('verifyCode', () => {
    it('issues a session token for the admin whose code was used', async () => {
      const { service, sentCodes, sessions } = buildHarness();
      await service.requestCode();

      const token = await service.verifyCode(sentCodes.get('admin-2')!, 'jest-agent');

      expect(token).toEqual(expect.any(String));
      expect(sessions.create).toHaveBeenCalledWith(
        expect.objectContaining({ discordUserId: 'admin-2', userAgent: 'jest-agent' }),
      );
    });

    it('never stores the raw token', async () => {
      const { service, sentCodes, sessions } = buildHarness();
      await service.requestCode();

      const token = await service.verifyCode(sentCodes.get('admin-1')!, null);

      expect(sessions.create.mock.calls[0][0].tokenHash).not.toBe(token);
    });

    it('burns the code so it cannot be replayed', async () => {
      const { service, sentCodes } = buildHarness();
      await service.requestCode();
      const code = sentCodes.get('admin-1')!;

      await service.verifyCode(code, null);
      await expect(service.verifyCode(code, null)).resolves.toBeNull();
    });

    it('invalidates the code after too many wrong attempts', async () => {
      const { service, sentCodes } = buildHarness();
      await service.requestCode();
      const code = sentCodes.get('admin-1')!;
      const wrong = code === '000000' ? '111111' : '000000';

      for (let attempt = 0; attempt < 5; attempt += 1) {
        await expect(service.verifyCode(wrong, null)).resolves.toBeNull();
      }

      await expect(service.verifyCode(code, null)).resolves.toBeNull();
    });

    it('rejects an empty submission', async () => {
      const { service } = buildHarness();
      await service.requestCode();

      await expect(service.verifyCode('', null)).resolves.toBeNull();
    });
  });

  describe('validateSession', () => {
    it('rejects an unknown token', async () => {
      const { service } = buildHarness();

      await expect(service.validateSession('nope')).resolves.toBe(false);
    });

    it('slides the expiry window when the session is a day stale', async () => {
      const { service, sessions } = buildHarness();
      const staleDate = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
      sessions.getLive.mockResolvedValue({ id: 'session-1', discordUserId: 'admin-1', lastUsedAt: staleDate });

      await expect(service.validateSession('token')).resolves.toBe(true);
      expect(sessions.touch).toHaveBeenCalledWith('session-1', expect.any(Date));
    });

    it('does not write on every request for a freshly used session', async () => {
      const { service, sessions } = buildHarness();
      sessions.getLive.mockResolvedValue({ id: 'session-1', discordUserId: 'admin-1', lastUsedAt: new Date() });

      await expect(service.validateSession('token')).resolves.toBe(true);
      expect(sessions.touch).not.toHaveBeenCalled();
    });
  });

  describe('cookieOptions', () => {
    it('locks the cookie to the admin area and blocks cross-site submissions', () => {
      const { service } = buildHarness();

      expect(service.cookieOptions).toMatchObject({ httpOnly: true, secure: true, sameSite: 'lax', path: '/admin' });
    });

    it('drops the secure flag when the service is not served over HTTPS', () => {
      const { service } = buildHarness({ secureCookies: false });

      expect(service.cookieOptions.secure).toBe(false);
    });
  });
});
