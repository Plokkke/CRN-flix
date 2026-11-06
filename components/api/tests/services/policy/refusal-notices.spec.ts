import { MediasRepository } from '@/services/database/medias';
import { PolicyRefusalEntity, PolicyRefusalsRepository } from '@/services/database/policy';
import { UsersRepository, UserStatus } from '@/services/database/users';
import { AllUserMessaging, UserMessagingDisabledError } from '@/services/messaging/user/all';
import { PolicyService } from '@/services/policy/policy';
import { PolicyRefusalNotices } from '@/services/policy/refusal-notices';

const refusal = (userId: string, imdbId: string): PolicyRefusalEntity => ({
  userId,
  imdbId,
  refusals: [
    { ruleId: 'r', ruleName: 'Violences', summary: 's', notices: [{ headline: 'Ce titre implique X', blocks: [] }] },
  ],
  refusedAt: new Date(),
  notifiedAt: null,
});

function build(mode: string, pending: PolicyRefusalEntity[], policyRefused = jest.fn().mockResolvedValue(undefined)) {
  const refusals = {
    listToNotify: jest.fn().mockResolvedValue(pending),
    markNotified: jest.fn().mockResolvedValue(undefined),
  };
  const users = {
    get: jest.fn((id: string) =>
      Promise.resolve({
        id,
        name: `user ${id}`,
        status: UserStatus.Active,
        messagingKey: 'email',
        messagingId: `${id}@x`,
      }),
    ),
  };
  const medias = { titlesOf: jest.fn().mockResolvedValue({ title: 'Movie', frenchTitle: 'Film', year: 2001 }) };
  const notices = new PolicyRefusalNotices(
    { mode } as unknown as PolicyService,
    refusals as unknown as PolicyRefusalsRepository,
    users as unknown as UsersRepository,
    medias as unknown as MediasRepository,
    { policyRefused } as unknown as AllUserMessaging,
  );
  return { notices, refusals, policyRefused };
}

describe('PolicyRefusalNotices', () => {
  it('sends one message per user for every title refused since the last one', async () => {
    const { notices, refusals, policyRefused } = build('enforce', [
      refusal('u1', 'tt1'),
      refusal('u1', 'tt2'),
      refusal('u2', 'tt1'),
    ]);

    await notices.notify();

    expect(policyRefused).toHaveBeenCalledTimes(2);
    expect(policyRefused).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u1' }), 'user u1', [
      expect.objectContaining({ title: 'Film', policies: [{ name: 'Violences', notices: expect.any(Array) }] }),
      expect.objectContaining({ title: 'Film' }),
    ]);
    expect(refusals.markNotified).toHaveBeenCalledWith('u1', ['tt1', 'tt2']);
  });

  it('counts nothing as told when messaging holds it back', async () => {
    const held = jest.fn().mockRejectedValue(new UserMessagingDisabledError('policy refusal', 'in quiet hours'));
    const { notices, refusals } = build('enforce', [refusal('u1', 'tt1')], held);

    await notices.notify();
    expect(refusals.markNotified).not.toHaveBeenCalled();
  });

  it('stays silent until the policy is enforced', async () => {
    const { notices, refusals } = build('dry-run', [refusal('u1', 'tt1')]);

    await notices.notify();
    expect(refusals.listToNotify).not.toHaveBeenCalled();
  });
});
