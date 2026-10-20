import { UserChannel } from '@crn-flix/contracts';

import { ContextService } from '@/services/context';
import { RequestEntity, RequestStatus } from '@/services/database/requests';
import { UserEntity } from '@/services/database/users';
import { AllUserMessaging } from '@/services/messaging/user/all';

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

function build() {
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
  const messaging = new AllUserMessaging([channel as UserChannel], context as unknown as ContextService);
  return { channel, messaging };
}

describe('AllUserMessaging', () => {
  afterEach(() => jest.useRealTimers());

  it('batches the request notices of one user into a single message, worded for users', async () => {
    jest.useFakeTimers();
    const { channel, messaging } = build();

    await messaging.requestUpdated(ctxt, request('m1', RequestStatus.Fulfilled, 1));
    await messaging.requestUpdated(ctxt, request('m2', RequestStatus.Rejected, 2));
    await jest.advanceTimersByTimeAsync(60_000);

    expect(channel.requestsUpdated).toHaveBeenCalledTimes(1);
    const [to, notices] = channel.requestsUpdated.mock.calls[0];
    expect(to.address).toBe('antoine@test');
    expect(notices).toEqual([
      expect.objectContaining({ title: 'Silo VF', episodeNumber: 1, outcome: 'fulfilled' }),
      expect.objectContaining({ episodeNumber: 2, outcome: 'rejected', posterUrl: 'https://img/silo.jpg' }),
    ]);
  });

  it('never notifies transient statuses', async () => {
    jest.useFakeTimers();
    const { channel, messaging } = build();

    await messaging.requestUpdated(ctxt, request('m1', RequestStatus.Pending, 1));
    await jest.advanceTimersByTimeAsync(60_000);

    expect(channel.requestsUpdated).not.toHaveBeenCalled();
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
