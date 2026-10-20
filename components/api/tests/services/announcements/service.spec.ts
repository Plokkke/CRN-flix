import { AnnouncementService } from '@/services/announcements/service';
import { UserEntity, UsersRepository, UserStatus } from '@/services/database/users';
import { ServiceNotice } from '@/services/messaging/user';
import { AllUserMessaging } from '@/services/messaging/user/all';

const user = (id: string, name: string, status = UserStatus.Active, messagingKey = 'email'): UserEntity => ({
  id,
  name,
  jellyfinId: null,
  messagingKey,
  messagingId: `${name}@test`,
  status,
  createdAt: new Date(),
  updatedAt: new Date(),
});

const notice: ServiceNotice = { subject: 's', title: 't', tone: 'info', paragraphs: ['p'] };

function setup(users: UserEntity[]) {
  const repo = { list: jest.fn().mockResolvedValue(users) } as unknown as UsersRepository;
  const announce = jest.fn().mockResolvedValue(undefined);
  const messaging = { announce } as unknown as AllUserMessaging;
  return { service: new AnnouncementService(repo, messaging), announce };
}

describe('AnnouncementService', () => {
  it('lists only active users, sorted by name', async () => {
    const { service } = setup([user('1', 'zoe'), user('2', 'Alice'), user('3', 'bob', UserStatus.Pending)]);
    expect((await service.listRecipients()).map((u) => u.name)).toEqual(['Alice', 'zoe']);
  });

  it('delivers to the selected users on their own channel and reports per-user outcomes', async () => {
    const { service, announce } = setup([user('1', 'a'), user('2', 'b', UserStatus.Active, 'discord'), user('3', 'c')]);
    announce.mockRejectedValueOnce(new Error('smtp down'));

    const results = await service.send(notice, ['1', '2', 'unknown']);

    expect(announce).toHaveBeenCalledTimes(2);
    expect(announce).toHaveBeenCalledWith({ key: 'discord', id: 'b@test' }, notice);
    expect(results.map((r) => [r.user.name, r.outcome, r.error])).toEqual([
      ['a', 'failed', 'smtp down'],
      ['b', 'sent', undefined],
    ]);
  });
});
