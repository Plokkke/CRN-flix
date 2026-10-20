import { UserChannel } from '@crn-flix/contracts';

import { ContextService } from '@/services/context';
import { RequestEntity, RequestStatus } from '@/services/database/requests';
import { UserMessagesRepository } from '@/services/database/user-messages';
import { UserNotificationsRepository } from '@/services/database/user-notifications';
import { UserEntity } from '@/services/database/users';
import {
  AllUserMessaging,
  QUIET_HOURS_EXEMPT_KINDS,
  UserMessagingDisabledError,
  UserMessagingMode,
} from '@/services/messaging/user/all';
import { QuietHours } from '@/services/messaging/user/quiet-hours';

const quietHours = new QuietHours({ window: '00:00-07:00', timeZone: 'Europe/Paris' });
const NOON = quietHours.parseLocal('2026-10-22T12:00')!;
const THREE_AM = quietHours.parseLocal('2026-10-22T03:00')!;

const ctxt = { key: 'email', id: 'antoine@test', userId: 'u1' };

function request(mediaId: string, status: RequestStatus, episodeNumber: number): RequestEntity {
  return {
    mediaId,
    status,
    media: {
      title: 'Silo',
      frenchTitle: 'Silo VF',
      year: 2023,
      type: 'episode',
      seasonNumber: 1,
      episodeNumber,
      posterUrl: 'https://img/silo.jpg',
    },
  } as unknown as RequestEntity;
}

function build(mode: UserMessagingMode = 'send', clock = { now: NOON }) {
  const channel = {
    kind: 'email',
    verify: jest.fn().mockResolvedValue(undefined),
    error: jest.fn().mockResolvedValue(undefined),
    welcome: jest.fn().mockResolvedValue(undefined),
    requestsUpdated: jest.fn().mockResolvedValue(undefined),
    loginChallenge: jest.fn().mockResolvedValue(undefined),
    announce: jest.fn().mockResolvedValue(undefined),
    catalogRelink: jest.fn().mockResolvedValue(undefined),
  };
  const context = {
    userGuideUrl: 'https://crn.test/user-guide',
    getTraktLinkUrl: (id: string) => `https://crn.test/users/${id}/trakt-link`,
    getRandomMedias: jest.fn().mockResolvedValue([]),
  };
  const notifications = {
    queue: jest.fn().mockResolvedValue(undefined),
    markSent: jest.fn().mockResolvedValue(undefined),
  };
  const journal = { record: jest.fn().mockResolvedValue(undefined) };
  const messaging = new AllUserMessaging(
    [channel as UserChannel],
    context as unknown as ContextService,
    notifications as unknown as UserNotificationsRepository,
    journal as unknown as UserMessagesRepository,
    mode,
    quietHours,
    () => clock.now,
  );
  return { channel, notifications, journal, messaging };
}

describe('AllUserMessaging', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('checks its channels off the boot path and retries every minute until they can send', async () => {
    const { channel, messaging } = build();
    channel.verify.mockRejectedValueOnce(new Error('Connection timeout'));

    messaging.onModuleInit();
    expect(messaging.canReachUsers).toBe(false);
    await jest.advanceTimersByTimeAsync(0);
    expect(messaging.canReachUsers).toBe(false);

    await jest.advanceTimersByTimeAsync(60_000);
    expect(channel.verify).toHaveBeenCalledTimes(2);
    expect(messaging.canReachUsers).toBe(true);
    await messaging.onModuleDestroy();
  });

  it('stays reachable through isolated failed checks, not through a lasting outage', async () => {
    const { channel, messaging } = build();
    messaging.onModuleInit();
    await jest.advanceTimersByTimeAsync(0);
    channel.verify.mockRejectedValue(new Error('Connection timeout'));

    await jest.advanceTimersByTimeAsync(15 * 60_000 + 60_000);
    expect(channel.verify).toHaveBeenCalledTimes(3);
    expect(messaging.canReachUsers).toBe(true);

    await jest.advanceTimersByTimeAsync(60_000);
    expect(messaging.canReachUsers).toBe(false);
    await messaging.onModuleDestroy();
  });

  it('batches the notices of one user into one message and marks them sent once delivered', async () => {
    const { channel, notifications, messaging } = build();

    await messaging.requestUpdated(ctxt, request('m1', RequestStatus.Fulfilled, 1));
    await messaging.requestUpdated(ctxt, request('m2', RequestStatus.Rejected, 2));
    expect(notifications.queue).toHaveBeenCalledWith({ userId: 'u1', mediaId: 'm1', status: RequestStatus.Fulfilled });
    expect(notifications.markSent).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(60_000);

    expect(channel.requestsUpdated).toHaveBeenCalledTimes(1);
    const [to, notices] = channel.requestsUpdated.mock.calls[0];
    expect(to.address).toBe('antoine@test');
    expect(notices).toEqual([
      expect.objectContaining({ title: 'Silo VF', episodeNumber: 1, outcome: 'fulfilled' }),
      expect.objectContaining({ episodeNumber: 2, outcome: 'rejected', posterUrl: 'https://img/silo.jpg' }),
    ]);
    expect(notifications.markSent).toHaveBeenCalledWith([
      { userId: 'u1', mediaId: 'm1', status: RequestStatus.Fulfilled },
      { userId: 'u1', mediaId: 'm2', status: RequestStatus.Rejected },
    ]);
  });

  it('leaves the notices queued when the channel fails to send', async () => {
    const { channel, notifications, messaging } = build();
    channel.requestsUpdated.mockRejectedValue(new Error('smtp down'));

    await messaging.requestUpdated(ctxt, request('m1', RequestStatus.Fulfilled, 1));
    await jest.advanceTimersByTimeAsync(60_000);

    expect(notifications.queue).toHaveBeenCalled();
    expect(notifications.markSent).not.toHaveBeenCalled();
  });

  it('never notifies transient statuses', async () => {
    const { channel, notifications, messaging } = build();

    await messaging.requestUpdated(ctxt, request('m1', RequestStatus.Pending, 1));
    await jest.advanceTimersByTimeAsync(60_000);

    expect(notifications.queue).not.toHaveBeenCalled();
    expect(channel.requestsUpdated).not.toHaveBeenCalled();
  });

  describe('in dry-run', () => {
    it('queues the notices but neither sends nor marks them sent', async () => {
      const { channel, notifications, messaging } = build('dry-run');

      await messaging.requestUpdated(ctxt, request('m1', RequestStatus.Fulfilled, 1));
      await jest.advanceTimersByTimeAsync(60_000);

      expect(notifications.queue).toHaveBeenCalled();
      expect(channel.requestsUpdated).not.toHaveBeenCalled();
      expect(notifications.markSent).not.toHaveBeenCalled();
    });

    it('refuses transactional messages so callers do not take them as delivered', async () => {
      const { channel, messaging } = build('dry-run');
      const user = { id: 'u1', name: 'antoine' } as UserEntity;

      await expect(messaging.registered(ctxt, user, 'pw')).rejects.toBeInstanceOf(UserMessagingDisabledError);
      await expect(messaging.error(ctxt, 'x')).rejects.toBeInstanceOf(UserMessagingDisabledError);
      expect(channel.welcome).not.toHaveBeenCalled();
      expect(channel.error).not.toHaveBeenCalled();
    });
  });

  describe('quiet hours', () => {
    it('exempts exactly the login code, the welcome and the registration refusal/error', () => {
      expect([...QUIET_HOURS_EXEMPT_KINDS].sort()).toEqual(['error', 'login', 'welcome']);
    });

    it('still sends exempt messages at night', async () => {
      const { channel, journal, messaging } = build('send', { now: THREE_AM });

      await messaging.loginChallenge(ctxt, {
        code: '123456',
        link: 'l',
        serviceName: 'CRN-Flix',
        expiresInMinutes: 10,
      });
      await messaging.registered(ctxt, { id: 'u1', name: 'antoine' } as UserEntity, 'pw');
      await messaging.error(ctxt, 'Votre inscription a été refusée');

      expect(channel.loginChallenge).toHaveBeenCalled();
      expect(channel.welcome).toHaveBeenCalled();
      expect(channel.error).toHaveBeenCalled();
      expect(journal.record).toHaveBeenCalledTimes(3);
    });

    it('holds every other message until morning, without recording it as sent', async () => {
      const { channel, journal, messaging } = build('send', { now: THREE_AM });

      await expect(messaging.catalogRelink(ctxt, 'antoine', 'Trakt')).rejects.toThrow(UserMessagingDisabledError);
      await expect(
        messaging.announce(ctxt, { subject: 's', title: 't', tone: 'info', paragraphs: [] }),
      ).rejects.toThrow('quiet hours until 22/10 à 07:00');

      expect(channel.catalogRelink).not.toHaveBeenCalled();
      expect(journal.record).not.toHaveBeenCalled();
      expect(messaging.quietUntil()?.toISOString()).toBe('2026-10-22T05:00:00.000Z');
    });

    it('keeps night notices queued, so the morning redelivery sends them as one batch', async () => {
      const clock = { now: THREE_AM };
      const { channel, notifications, messaging } = build('send', clock);

      await messaging.requestUpdated(ctxt, request('m1', RequestStatus.Fulfilled, 1));
      await jest.advanceTimersByTimeAsync(60_000);
      expect(channel.requestsUpdated).not.toHaveBeenCalled();
      expect(notifications.markSent).not.toHaveBeenCalled();

      clock.now = quietHours.parseLocal('2026-10-22T07:05')!;
      await messaging.requestUpdated(ctxt, request('m1', RequestStatus.Fulfilled, 1));
      await jest.advanceTimersByTimeAsync(60_000);
      expect(channel.requestsUpdated).toHaveBeenCalledTimes(1);
      expect(notifications.markSent).toHaveBeenCalled();
    });
  });

  it('welcomes a user with everything needed to start', async () => {
    const { channel, messaging } = build();

    await messaging.registered(ctxt, { id: 'u1', name: 'antoine' } as UserEntity, 'pw');

    expect(channel.welcome).toHaveBeenCalledWith(
      { name: 'antoine', address: 'antoine@test' },
      expect.objectContaining({ password: 'pw', catalogLinkUrl: 'https://crn.test/users/u1/trakt-link' }),
    );
  });

  it('fails loudly for a channel nobody plugged in', async () => {
    const { messaging } = build();

    await expect(messaging.error({ key: 'discord', id: 'd1', userId: 'u1' }, 'boom')).rejects.toThrow(
      'No user messaging channel',
    );
  });

  describe('delivery journal', () => {
    it('journals a message once the channel delivered it', async () => {
      const { journal, messaging } = build();

      await messaging.catalogRelink(ctxt, 'antoine', 'Trakt');
      await messaging.requestUpdated(ctxt, request('m1', RequestStatus.Fulfilled, 1));
      await jest.advanceTimersByTimeAsync(60_000);

      expect(journal.record.mock.calls).toEqual([
        ['u1', 'catalog-relink', 'email'],
        ['u1', 'requests-updated', 'email'],
      ]);
    });

    it('journals nothing in dry-run nor when the channel failed', async () => {
      const dryRun = build('dry-run');
      const failing = build();
      failing.channel.loginChallenge.mockRejectedValue(new Error('smtp down'));
      const challenge = { code: '1', link: 'l', serviceName: 's', expiresInMinutes: 10 };

      await expect(dryRun.messaging.announce(ctxt, { subject: 's' } as never)).rejects.toThrow(
        UserMessagingDisabledError,
      );
      await expect(failing.messaging.loginChallenge(ctxt, challenge)).rejects.toThrow('smtp down');

      expect(dryRun.journal.record).not.toHaveBeenCalled();
      expect(failing.journal.record).not.toHaveBeenCalled();
    });

    it('still reports a delivered message as sent when the journal fails', async () => {
      const { journal, messaging } = build();
      journal.record.mockRejectedValue(new Error('db down'));

      await expect(messaging.error(ctxt, 'x')).resolves.toBeUndefined();
    });

    it('links the relink ask to the user own catalog page', async () => {
      const { channel, messaging } = build();

      await messaging.catalogRelink(ctxt, 'antoine', 'Trakt');

      expect(channel.catalogRelink).toHaveBeenCalledWith(
        { name: 'antoine', address: 'antoine@test' },
        { catalogName: 'Trakt', linkUrl: 'https://crn.test/users/u1/trakt-link' },
      );
    });
  });
});
