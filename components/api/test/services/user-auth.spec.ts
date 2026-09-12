import { MemoryCacheService } from '@/services/cache/memory-cache.service';
import { UserSessionsRepository } from '@/services/database/user-sessions';
import { UserEntity, UsersRepository, UserStatus } from '@/services/database/users';
import { LoginChallenge } from '@/services/messaging/user';
import { AllUserMessaging, UserMessagingCtxt } from '@/services/messaging/user/all';
import { UserAuthService } from '@/services/user-auth';

const USER: UserEntity = {
  id: 'user-1',
  name: 'Alice',
  jellyfinId: 'jf-1',
  messagingKey: 'email',
  messagingId: 'alice@example.com',
  status: UserStatus.Active,
  createdAt: new Date(),
  updatedAt: new Date(),
};

type Harness = {
  service: UserAuthService;
  cache: MemoryCacheService;
  sessions: jest.Mocked<UserSessionsRepository>;
  loginChallenge: jest.Mock;
  lastChallenge: () => { ctxt: UserMessagingCtxt; challenge: LoginChallenge };
};

function buildHarness(user: UserEntity | null = USER): Harness {
  const loginChallenge = jest.fn(async () => undefined);
  const sessions = {
    create: jest.fn(async () => undefined),
    getLive: jest.fn(async () => null),
    touch: jest.fn(async () => undefined),
    revoke: jest.fn(async () => undefined),
  } as unknown as jest.Mocked<UserSessionsRepository>;
  const users = { getByName: jest.fn(async () => user) } as unknown as UsersRepository;

  const cache = new MemoryCacheService();
  const service = new UserAuthService(
    { serviceName: 'CRN-Flix', serverUrl: 'https://flix.example', secureCookies: true },
    sessions,
    cache,
    users,
    { loginChallenge } as unknown as AllUserMessaging,
  );

  const lastChallenge = (): { ctxt: UserMessagingCtxt; challenge: LoginChallenge } => {
    const [ctxt, challenge] = loginChallenge.mock.calls[loginChallenge.mock.calls.length - 1] as unknown as [
      UserMessagingCtxt,
      LoginChallenge,
    ];
    return { ctxt, challenge };
  };

  return { service, cache, sessions, loginChallenge, lastChallenge };
}

const linkToken = (link: string): string => new URL(link).searchParams.get('t')!;

describe('UserAuthService', () => {
  describe('requestCode', () => {
    it('delivers a code and a magic link through the user messaging channel', async () => {
      const { service, lastChallenge } = buildHarness();

      await expect(service.requestCode('alice')).resolves.toEqual({ outcome: 'sent', userId: 'user-1' });

      const { ctxt, challenge } = lastChallenge();
      expect(ctxt).toEqual({ key: 'email', id: 'alice@example.com' });
      expect(challenge.code).toMatch(/^\d{6}$/);
      expect(challenge.link).toMatch(/^https:\/\/flix\.example\/me\/login\/link\?u=user-1&t=/);
    });

    it('rejects an unknown pseudo without sending anything', async () => {
      const { service, loginChallenge } = buildHarness(null);

      await expect(service.requestCode('nobody')).resolves.toEqual({ outcome: 'unknown-user', userId: null });
      expect(loginChallenge).not.toHaveBeenCalled();
    });

    it('rejects a user whose registration is still pending', async () => {
      const { service, loginChallenge } = buildHarness({ ...USER, status: UserStatus.Pending });

      await expect(service.requestCode('alice')).resolves.toMatchObject({ outcome: 'unknown-user' });
      expect(loginChallenge).not.toHaveBeenCalled();
    });

    it('throttles a second request within the cooldown', async () => {
      const { service, loginChallenge } = buildHarness();

      await service.requestCode('alice');
      await expect(service.requestCode('alice')).resolves.toMatchObject({ outcome: 'throttled' });
      expect(loginChallenge).toHaveBeenCalledTimes(1);
    });

    it('reports a delivery failure and retains no challenge', async () => {
      const { service, loginChallenge, cache } = buildHarness();
      loginChallenge.mockRejectedValue(new Error('smtp down'));

      await expect(service.requestCode('alice')).resolves.toMatchObject({ outcome: 'delivery-failed' });
      await expect(service.verifyCode('user-1', '000000', null)).resolves.toBeNull();
      await cache.flush();
    });
  });

  describe('verifyCode / verifyLink', () => {
    it('opens a session for the user when the code matches', async () => {
      const { service, lastChallenge, sessions } = buildHarness();
      await service.requestCode('alice');

      const token = await service.verifyCode('user-1', lastChallenge().challenge.code, 'jest-agent');

      expect(token).toEqual(expect.any(String));
      expect(sessions.create).toHaveBeenCalledWith(
        expect.objectContaining({ subjectId: 'user-1', userAgent: 'jest-agent' }),
      );
      expect(sessions.create.mock.calls[0][0].tokenHash).not.toBe(token);
    });

    it('opens a session when the magic link token matches', async () => {
      const { service, lastChallenge } = buildHarness();
      await service.requestCode('alice');

      const token = await service.verifyLink('user-1', linkToken(lastChallenge().challenge.link), null);

      expect(token).toEqual(expect.any(String));
    });

    it('does not accept the code where the link token is expected, nor the reverse', async () => {
      const { service, lastChallenge } = buildHarness();
      await service.requestCode('alice');
      const { code, link } = lastChallenge().challenge;

      await expect(service.verifyLink('user-1', code, null)).resolves.toBeNull();
      await expect(service.verifyCode('user-1', linkToken(link), null)).resolves.toBeNull();
    });

    it('burns the challenge once either proof is used', async () => {
      const { service, lastChallenge } = buildHarness();
      await service.requestCode('alice');
      const { code, link } = lastChallenge().challenge;

      await service.verifyLink('user-1', linkToken(link), null);
      await expect(service.verifyCode('user-1', code, null)).resolves.toBeNull();
    });

    it('rejects a proof presented for another user', async () => {
      const { service, lastChallenge } = buildHarness();
      await service.requestCode('alice');

      await expect(service.verifyCode('user-2', lastChallenge().challenge.code, null)).resolves.toBeNull();
    });

    it('invalidates the challenge after too many wrong attempts', async () => {
      const { service, lastChallenge } = buildHarness();
      await service.requestCode('alice');
      const code = lastChallenge().challenge.code;
      const wrong = code === '000000' ? '111111' : '000000';

      for (let attempt = 0; attempt < 5; attempt += 1) {
        await expect(service.verifyCode('user-1', wrong, null)).resolves.toBeNull();
      }

      await expect(service.verifyCode('user-1', code, null)).resolves.toBeNull();
    });

    it('rejects an empty submission', async () => {
      const { service } = buildHarness();
      await service.requestCode('alice');

      await expect(service.verifyCode('user-1', '', null)).resolves.toBeNull();
    });
  });

  describe('cookies', () => {
    it('locks the session cookie to the subscriber area', () => {
      const { service } = buildHarness();

      expect(service.cookieOptions).toMatchObject({ httpOnly: true, secure: true, sameSite: 'lax', path: '/me' });
    });

    it('keeps the pending-login cookie only as long as the challenge', () => {
      const { service } = buildHarness();

      expect(service.loginCookieOptions).toMatchObject({ path: '/me', maxAge: 10 * 60 * 1000 });
    });
  });
});
