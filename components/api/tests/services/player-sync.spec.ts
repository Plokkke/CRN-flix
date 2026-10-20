import { MediaType, Player, PlayerAsset } from '@crn-flix/contracts';

import { MediasRepository } from '@/services/database/medias';
import { RequestsRepository } from '@/services/database/requests';
import { PlayerAccountsService } from '@/services/player-accounts';
import { PlayerSyncService } from '@/services/player-sync';

const asset: PlayerAsset = {
  imdbId: 'tt14688458',
  type: MediaType.Episode,
  title: 'Silo',
  originalTitle: null,
  frenchTitle: null,
  originalLanguage: null,
  year: 2023,
  seasonNumber: 1,
  episodeNumber: 1,
  runtimeMinutes: null,
};

describe('PlayerSyncService', () => {
  it('marks every available asset as a fulfilled request, then puts the accounts back on the rules', async () => {
    const medias = { upsert: jest.fn().mockResolvedValue({ id: 'media-1' }) };
    const requests = { upsertFulfilled: jest.fn().mockResolvedValue(undefined) };
    const player = { name: 'test', listAvailable: jest.fn().mockResolvedValue([asset]) };
    const accounts = { applyAll: jest.fn().mockResolvedValue(undefined) };

    await new PlayerSyncService(
      requests as unknown as RequestsRepository,
      medias as unknown as MediasRepository,
      player as unknown as Player,
      accounts as unknown as PlayerAccountsService,
    ).sync();

    expect(medias.upsert).toHaveBeenCalledWith(asset);
    expect(requests.upsertFulfilled).toHaveBeenCalledWith('media-1');
    expect(accounts.applyAll).toHaveBeenCalled();
  });
});
