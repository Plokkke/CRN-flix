import { UserChannel } from '@crn-flix/contracts';

import { ContextService } from '@/services/context';
import { RequestEntity, RequestStatus } from '@/services/database/requests';
import { UserNotificationsRepository } from '@/services/database/user-notifications';
import { UserEntity } from '@/services/database/users';
import { AllUserMessaging, UserMessagingDisabledError, UserMessagingMode } from '@/services/messaging/user/all';

const ctxt = { key: 'email', id: 'antoine@test' };

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

function build(mode: UserMessagingMode = 'send') {
  const channel = {
    kind: 'email',
    verify: jest.fn().mockResolvedValue(undefined),
    error: jest.fn().mockResolvedValue(undefined),
    welcome: jest.fn().mockResolvedValue(undefined),
    requestsUpdated: jest.fn().mockResolvedValue(undefined),
    loginChallenge: jest.fn().mockResolvedValue(undefined),
    announce: jest.fn().mockResolvedValue(undefined),
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
  const messaging = new AllUserMessaging(
    [channel as UserChannel],
    context as unknown as ContextService,
    notifications as unknown as UserNotificationsRepository,
    mode,
  );
  return { channel, notifications, messaging };
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

    await messaging.requestUpdated(ctxt, request('m1', RequestStatus.Fulfilled, 1), 'u1');
    await messaging.requestUpdated(ctxt, request('m2', RequestStatus.Rejected, 2), 'u1');
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

    await messaging.requestUpdated(ctxt, request('m1', RequestStatus.Fulfilled, 1), 'u1');
    await jest.advanceTimersByTimeAsync(60_000);

    expect(notifications.queue).toHaveBeenCalled();
    expect(notifications.markSent).not.toHaveBeenCalled();
  });

  it('never notifies transient statuses', async () => {
    const { channel, notifications, messaging } = build();

    await messaging.requestUpdated(ctxt, request('m1', RequestStatus.Pending, 1), 'u1');
    await jest.advanceTimersByTimeAsync(60_000);

    expect(notifications.queue).not.toHaveBeenCalled();
    expect(channel.requestsUpdated).not.toHaveBeenCalled();
  });

  describe('in dry-run', () => {
    it('queues the notices but neither sends nor marks them sent', async () => {
      const { channel, notifications, messaging } = build('dry-run');

      await messaging.requestUpdated(ctxt, request('m1', RequestStatus.Fulfilled, 1), 'u1');
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

    await expect(messaging.error({ key: 'discord', id: 'd1' }, 'boom')).rejects.toThrow('No user messaging channel');
  });
});
