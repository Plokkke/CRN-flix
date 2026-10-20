import { Logger } from '@nestjs/common';

import { Player } from '@crn-flix/contracts';

import { MediasRepository } from '@/services/database/medias';
import { RequestsRepository } from '@/services/database/requests';
import { PlayerAccountsService } from '@/services/player-accounts';

/** Whatever the player can serve is a fulfilled request: the status change notifies requesters. */
export class PlayerSyncService {
  private static readonly logger = new Logger(PlayerSyncService.name);

  constructor(
    private readonly requestsRepository: RequestsRepository,
    private readonly mediasRepository: MediasRepository,
    private readonly player: Player,
    private readonly accounts: PlayerAccountsService,
  ) {}

  async sync(): Promise<void> {
    PlayerSyncService.logger.log(`Importing ${this.player.name} assets as fulfilled media/requests`);

    const assets = await this.player.listAvailable();
    for (const asset of assets) {
      const media = await this.mediasRepository.upsert(asset);
      await this.requestsRepository.upsertFulfilled(media.id);
    }

    PlayerSyncService.logger.log(`${this.player.name} sync completed: ${assets.length} upserted`);
    await this.accounts.applyAll();
  }
}
