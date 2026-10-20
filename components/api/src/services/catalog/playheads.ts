import { Logger } from '@nestjs/common';

import { Catalog, Playhead, START_OF_SHOW } from '@crn-flix/contracts';

import { IntegrationTracker } from '@/services/integrations/monitor';

import { CatalogAccountsService } from './accounts';

/**
 * Playheads are the catalog's data — read on demand, never persisted, so they cannot drift.
 * The catalog caches its calls on the user's activity timestamps, so planner passes stay cheap.
 */
export class CatalogPlayheadService {
  private static readonly logger = new Logger(CatalogPlayheadService.name);

  constructor(
    private readonly accounts: CatalogAccountsService,
    private readonly catalog: Catalog,
    private readonly integrations: IntegrationTracker,
  ) {}

  async getPlayheads(showImdbId: string, userIds: string[]): Promise<Playhead[]> {
    const accountByUserId = new Map((await this.accounts.list()).map(({ user, account }) => [user.id, account]));

    return Promise.all(
      userIds.map(async (userId) => {
        const account = accountByUserId.get(userId);
        if (!account) {
          // No catalog link: the user never scrobbled anything, everything lies ahead.
          return START_OF_SHOW;
        }
        try {
          return await this.integrations.track(this.catalog.name, 'playhead', () =>
            this.catalog.playhead(account, showImdbId),
          );
        } catch (error) {
          CatalogPlayheadService.logger.warn(
            `Failed to fetch playhead of ${showImdbId} for user ${userId}: ${error instanceof Error ? error.message : error}`,
          );
          return START_OF_SHOW;
        }
      }),
    );
  }
}
