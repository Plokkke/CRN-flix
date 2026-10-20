import { CatalogAccountSource } from '@crn-flix/contracts';

import { CatalogAccountsService } from '@/services/catalog/accounts';
import { UsersRepository } from '@/services/database/users';

describe('CatalogAccountsService', () => {
  it('ties each linked catalog account to the user owning that player account', async () => {
    const users = {
      list: jest.fn().mockResolvedValue([
        { id: 'u1', jellyfinId: 'jf1' },
        { id: 'u2', jellyfinId: null },
      ]),
    };
    const source = {
      listAccounts: jest.fn().mockResolvedValue([
        { playerAccountId: 'jf1', credentials: { token: 'a' } },
        { playerAccountId: 'jf-unknown', credentials: { token: 'b' } },
      ]),
    };

    const accounts = await new CatalogAccountsService(
      users as unknown as UsersRepository,
      source as CatalogAccountSource,
    ).list();

    expect(accounts).toEqual([
      { user: { id: 'u1', jellyfinId: 'jf1' }, account: { userRef: 'u1', credentials: { token: 'a' } } },
    ]);
  });
});
