import { CatalogAccountSource, Player } from '@crn-flix/contracts';

import { UserEntity, UsersRepository, UserStatus } from '@/services/database/users';
import { PlayerAccountsService } from '@/services/player-accounts';

const user = (overrides: Partial<UserEntity>): UserEntity =>
  ({ id: 'u1', name: 'one', jellyfinId: 'jf1', maxStreams: 1, status: UserStatus.Active, ...overrides }) as UserEntity;

function build(users: UserEntity[], accountIds: string[] = []) {
  const usersRepository = {
    list: jest.fn().mockResolvedValue(users),
    setMaxStreams: jest.fn().mockResolvedValue(undefined),
  };
  const player = {
    accountMaxStreams: jest.fn().mockResolvedValue(3),
    applyAccountPolicy: jest.fn().mockResolvedValue(true),
    listAccountIds: jest.fn().mockResolvedValue(accountIds),
  };
  const catalogAccounts = { enforceSettings: jest.fn().mockResolvedValue(0) };
  const service = new PlayerAccountsService(
    usersRepository as unknown as UsersRepository,
    player as unknown as Player,
    catalogAccounts as unknown as CatalogAccountSource,
  );
  return { usersRepository, player, catalogAccounts, service };
}

describe('PlayerAccountsService', () => {
  it('applies the stream limit kept in database', async () => {
    const { player, usersRepository, service } = build([]);

    await service.apply(user({ maxStreams: 2 }));

    expect(player.applyAccountPolicy).toHaveBeenCalledWith('jf1', { maxStreams: 2 });
    expect(player.accountMaxStreams).not.toHaveBeenCalled();
    expect(usersRepository.setMaxStreams).not.toHaveBeenCalled();
  });

  it('adopts the limit the player account already allows the first time, so a family keeps its streams', async () => {
    const { player, usersRepository, service } = build([]);

    await service.apply(user({ maxStreams: null }));

    expect(usersRepository.setMaxStreams).toHaveBeenCalledWith('u1', 3);
    expect(player.applyAccountPolicy).toHaveBeenCalledWith('jf1', { maxStreams: 3 });
  });

  it('leaves alone an account the player administers itself', async () => {
    const { player, usersRepository, service } = build([]);
    player.accountMaxStreams.mockResolvedValue(null);

    await service.apply(user({ maxStreams: null }));

    expect(usersRepository.setMaxStreams).not.toHaveBeenCalled();
    expect(player.applyAccountPolicy).not.toHaveBeenCalled();
  });

  it('applies the rules to every player account, the stream limit only where the database knows it', async () => {
    const { player, catalogAccounts, service } = build(
      [
        user({ id: 'u1', jellyfinId: 'jf1', maxStreams: 2 }),
        user({ id: 'u3', jellyfinId: 'jf3', status: UserStatus.Pending }),
      ],
      ['jf1', 'jf-guest', 'jf3', 'jf4'],
    );
    player.applyAccountPolicy.mockRejectedValueOnce(new Error('502'));

    await service.applyAll();

    expect(player.applyAccountPolicy.mock.calls).toEqual([
      ['jf1', { maxStreams: 2 }],
      ['jf-guest', { maxStreams: undefined }],
      ['jf3', { maxStreams: undefined }],
      ['jf4', { maxStreams: undefined }],
    ]);
    expect(catalogAccounts.enforceSettings).toHaveBeenCalled();
  });
});
