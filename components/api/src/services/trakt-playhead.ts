import { Logger } from '@nestjs/common';

import { TraktPlugin } from '@/modules/jellyfin/plugins/trakt';
import { TraktApi } from '@/modules/trakt/api';
import { UserAuthCtxt } from '@/modules/trakt/types';
import { UsersRepository } from '@/services/database/users';
import { Playhead, START_OF_SHOW } from '@/services/planner/model';

/** Completed or dropped: the show only ever contributes deferred urgency. */
const COMPLETED: Playhead = { nextSeason: null, nextEpisode: null };

/**
 * Playheads are Trakt's data — derived on demand, never persisted, so they cannot drift.
 * Every Trakt call under here is cached on the user's activity timestamps (last_activities
 * itself has a 60s cache), so planner passes cost at most one HTTP call per user per minute.
 */
export class TraktPlayheadService {
  private static readonly logger = new Logger(TraktPlayheadService.name);

  constructor(
    private readonly usersRepository: UsersRepository,
    private readonly traktPlugin: TraktPlugin,
    private readonly traktClient: TraktApi,
  ) {}

  async getPlayheads(showImdbId: string, userIds: string[]): Promise<Playhead[]> {
    const authByUserId = await this.authContexts();

    return Promise.all(
      userIds.map(async (userId) => {
        const auth = authByUserId.get(userId);
        if (!auth) {
          // No Trakt link: the user never scrobbled anything, everything lies ahead.
          return START_OF_SHOW;
        }
        try {
          return await this.playheadOf(auth, showImdbId);
        } catch (error) {
          TraktPlayheadService.logger.warn(
            `Failed to fetch playhead of ${showImdbId} for user ${userId}: ${error instanceof Error ? error.message : error}`,
          );
          return START_OF_SHOW;
        }
      }),
    );
  }

  private async authContexts(): Promise<Map<string, UserAuthCtxt>> {
    const [users, contexts] = await Promise.all([this.usersRepository.list(), this.traktPlugin.getUsersAuthContext()]);

    const entries = contexts.flatMap((context): [string, UserAuthCtxt][] => {
      const user = users.find((u) => u.jellyfinId === context.jellyfinId);
      return user ? [[user.id, { id: user.id, accessToken: context.accessToken }]] : [];
    });
    return new Map(entries);
  }

  private async playheadOf(auth: UserAuthCtxt, showImdbId: string): Promise<Playhead> {
    const watched = await this.traktClient.requestUserWatched(auth);
    const entry = watched.find((w) => w.show.ids.imdb === showImdbId);
    if (!entry) {
      return START_OF_SHOW;
    }

    const excludedShowIds = await this.traktClient.listExcludedShowIds(auth);
    if (excludedShowIds.has(entry.show.ids.trakt)) {
      return COMPLETED;
    }

    const progress = await this.traktClient.requestShowProgress(auth, entry.show.ids.trakt);
    if (!progress.next_episode || progress.aired <= progress.completed) {
      return COMPLETED;
    }
    return { nextSeason: progress.next_episode.season, nextEpisode: progress.next_episode.number };
  }
}
