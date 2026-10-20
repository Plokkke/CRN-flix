import { CatalogRelinkService } from '@/services/catalog/relink';
import { UserEntity, UsersRepository } from '@/services/database/users';
import { AllUserMessaging, UserMessagingDisabledError } from '@/services/messaging/user/all';

const user = (overrides: Partial<UserEntity> = {}): UserEntity =>
  ({
    id: 'u1',
    name: 'one',
    messagingKey: 'email',
    messagingId: 'one@test',
    catalogRelinkRequestedAt: null,
    ...overrides,
  }) as UserEntity;

function build() {
  const users = { setCatalogRelinkRequestedAt: jest.fn().mockResolvedValue(undefined) };
  const messaging = { catalogRelink: jest.fn().mockResolvedValue(undefined) };
  const service = new CatalogRelinkService(
    users as unknown as UsersRepository,
    messaging as unknown as AllUserMessaging,
    'Trakt',
  );
  return { users, messaging, service };
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

describe('CatalogRelinkService', () => {
  it('asks once per revocation, even when listings report it concurrently', async () => {
    const { users, messaging, service } = build();

    service.revoked(user());
    service.revoked(user());
    await settle();
    service.revoked(user());
    await settle();

    expect(messaging.catalogRelink).toHaveBeenCalledTimes(1);
    expect(messaging.catalogRelink).toHaveBeenCalledWith(
      { key: 'email', id: 'one@test', userId: 'u1' },
      'one',
      'Trakt',
    );
    expect(users.setCatalogRelinkRequestedAt).toHaveBeenCalledWith('u1', expect.any(Date));
  });

  it('does not ask a user already asked before a restart', async () => {
    const { messaging, service } = build();

    service.revoked(user({ catalogRelinkRequestedAt: new Date() }));
    await settle();

    expect(messaging.catalogRelink).not.toHaveBeenCalled();
  });

  it('asks again after the account worked then got revoked again', async () => {
    const { users, messaging, service } = build();

    service.revoked(user());
    await settle();
    service.usable(user({ catalogRelinkRequestedAt: new Date() }));
    await settle();
    service.revoked(user());
    await settle();

    expect(users.setCatalogRelinkRequestedAt).toHaveBeenCalledWith('u1', null);
    expect(messaging.catalogRelink).toHaveBeenCalledTimes(2);
  });

  it('records nothing when the ask was not delivered, and tries again later', async () => {
    const { users, messaging, service } = build();
    messaging.catalogRelink
      .mockRejectedValueOnce(new UserMessagingDisabledError('catalog relink'))
      .mockRejectedValueOnce(new Error('smtp down'));

    service.revoked(user());
    await settle();
    service.revoked(user());
    await settle();

    expect(users.setCatalogRelinkRequestedAt).not.toHaveBeenCalled();
    service.revoked(user());
    await settle();
    expect(messaging.catalogRelink).toHaveBeenCalledTimes(3);
    expect(users.setCatalogRelinkRequestedAt).toHaveBeenCalledTimes(1);
  });

  it('leaves a healthy account that was never asked alone', () => {
    const { users, service } = build();

    service.usable(user());

    expect(users.setCatalogRelinkRequestedAt).not.toHaveBeenCalled();
  });
});
