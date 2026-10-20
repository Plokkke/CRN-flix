import { Logger } from '@nestjs/common';
import * as _ from 'lodash';
import { DateTime } from 'luxon';
import { z } from 'zod';

import { Catalog, CatalogAccount, CatalogItem, RequestReason } from '@crn-flix/contracts';

import { concurrent } from '@/helpers/concurrent';
import { MediaInfos, MediasRepository, MediaType } from '@/services/database/medias';
import { RequestsRepository, RequestStatus, SyncRequestSnapshot } from '@/services/database/requests';
import { UserActivitiesRepository } from '@/services/database/user-activities';
import { type UserEntity } from '@/services/database/users';
import { PlannerService } from '@/services/planner/planner';
import { TicketCategory } from '@/services/tickets/model';
import { TicketService } from '@/services/tickets/ticket.service';

import { CatalogAccountsService } from './accounts';

export const syncConfigSchema = z.object({
  ratingThreshold: z.number().int().optional().default(10),
  /** Missing episodes within this window of unwatched viewing time are `needed`. */
  needWindowHours: z.number().positive().optional().default(5),
  /** Soft ceiling on the viewing hours one action may pull in. */
  maxWindowHours: z.number().positive().optional().default(25),
  fullSyncIntervalHours: z.number().int().positive().optional().default(24),
});

export type SyncConfig = z.infer<typeof syncConfigSchema>;

type MediaCompositeKey = string;

function compositeKey(media: Pick<MediaInfos, 'imdbId' | 'seasonNumber' | 'episodeNumber'>): MediaCompositeKey {
  return `${media.imdbId}:${media.seasonNumber ?? -1}:${media.episodeNumber ?? -1}`;
}

function toMediaInfos({ catalogSlug, ...media }: CatalogItem): MediaInfos {
  return { ...media, traktSlug: catalogSlug };
}

const NEW_REQUEST_CONCURRENCY = 5;

type DesiredMedia = {
  mediaInfos: MediaInfos;
  requestKindsByUserId: Record<UserEntity['id'], Set<RequestReason>>;
};

type DesiredMediaByKey = Record<MediaCompositeKey, DesiredMedia>;

type GatheredData = {
  desiredMediaByKey: DesiredMediaByKey;
  syncedKindsByUserId: Record<UserEntity['id'], Set<RequestReason>>;
  mediaRequests: SyncRequestSnapshot[];
};

function addDesired(desired: DesiredMediaByKey, userId: string, kind: RequestReason, medias: MediaInfos[]): void {
  for (const media of medias) {
    const entry = (desired[compositeKey(media)] ??= { mediaInfos: media, requestKindsByUserId: {} });
    entry.requestKindsByUserId[userId] ??= new Set();
    entry.requestKindsByUserId[userId].add(kind);
  }
}

export class CatalogSyncService {
  private static readonly logger = new Logger(CatalogSyncService.name);

  constructor(
    private readonly config: SyncConfig,
    private readonly catalog: Catalog,
    private readonly accounts: CatalogAccountsService,
    private readonly userActivitiesRepository: UserActivitiesRepository,
    private readonly mediasRepository: MediasRepository,
    private readonly requestsRepository: RequestsRepository,
    private readonly planner: PlannerService,
    private readonly ticketService: TicketService,
  ) {}

  async sync(): Promise<void> {
    CatalogSyncService.logger.log(`Starting ${this.catalog.name} sync`);

    const gathered = await this.gather();
    const mediaRequestByKey = _.keyBy(gathered.mediaRequests, (r) => compositeKey(r));

    // Existing requests: sync user reasons (synchronous, no API calls)
    for (const snapshot of gathered.mediaRequests) {
      const desiredKindsByUserId = gathered.desiredMediaByKey[compositeKey(snapshot)]?.requestKindsByUserId ?? {};
      await this.syncRequestReasons(snapshot, desiredKindsByUserId, gathered.syncedKindsByUserId);
    }

    const newMediaRequests = Object.entries(gathered.desiredMediaByKey).filter(([key]) => !mediaRequestByKey[key]);
    CatalogSyncService.logger.log(
      `Processing ${newMediaRequests.length} new medias (concurrency: ${NEW_REQUEST_CONCURRENCY})`,
    );

    const createdIds = await concurrent(newMediaRequests, NEW_REQUEST_CONCURRENCY, ([, desired]) =>
      this.processNewRequest(desired),
    );

    const mediaIdByKey: Record<MediaCompositeKey, string> = {};
    for (const snapshot of gathered.mediaRequests) {
      mediaIdByKey[compositeKey(snapshot)] = snapshot.mediaId;
    }
    newMediaRequests.forEach(([key], index) => {
      if (createdIds[index]) {
        mediaIdByKey[key] = createdIds[index];
      }
    });
    await this.openMissingImdbTickets(gathered, mediaIdByKey);

    for (const [userId, kinds] of Object.entries(gathered.syncedKindsByUserId)) {
      for (const kind of kinds) {
        await this.userActivitiesRepository.upsert(userId, kind);
      }
    }

    CatalogSyncService.logger.log(`${this.catalog.name} sync completed`);
  }

  // --- Phase 1: GATHER ---

  private async gather(): Promise<GatheredData> {
    const accounts = await this.accounts.list();

    CatalogSyncService.logger.log('Gathering catalog activities');
    const desiredMediaByKey: DesiredMediaByKey = {};
    const syncedKindsByUserId: GatheredData['syncedKindsByUserId'] = {};

    let failed = 0;
    for (const { user, account } of accounts) {
      try {
        const mediasByKind = await this.gatherAccount(user, account);
        syncedKindsByUserId[user.id] = new Set(mediasByKind.keys());
        mediasByKind.forEach((medias, kind) => addDesired(desiredMediaByKey, user.id, kind, medias));
      } catch (error) {
        // Left out entirely: a partial read would drop the requests of the kinds it missed.
        failed += 1;
        CatalogSyncService.logger.warn(
          `User ${user.name}: catalog unreachable, left out of this sync (${error instanceof Error ? error.message : error})`,
        );
      }
    }

    CatalogSyncService.logger.log(
      `Gathered ${Object.keys(desiredMediaByKey).length} unique desired medias across ${accounts.length - failed} users (${failed} left out)`,
    );

    const desiredKeys = Object.values(desiredMediaByKey).map((d) => d.mediaInfos);
    const mediaRequests = await this.requestsRepository.listSyncSnapshot(desiredKeys, Object.keys(syncedKindsByUserId));
    CatalogSyncService.logger.log(`Current requests: ${mediaRequests.length}`);

    return { desiredMediaByKey, syncedKindsByUserId, mediaRequests };
  }

  /** Everything one account asks for, per kind; throws without partial result. */
  private async gatherAccount(user: UserEntity, account: CatalogAccount): Promise<Map<RequestReason, MediaInfos[]>> {
    const kinds = await this.getKindsToSync(user.id, account);
    CatalogSyncService.logger.log(`User ${user.name}: syncing kinds ${Array.from(kinds).join(', ')}`);

    const mediasByKind = new Map<RequestReason, MediaInfos[]>();
    for (const kind of kinds) {
      const medias = await this.listRequests(account, kind);
      CatalogSyncService.logger.log(`User ${user.name} kind ${kind}: ${medias.length} medias`);
      mediasByKind.set(kind, medias);
    }
    return mediasByKind;
  }

  /**
   * Progress only changes when the user watched something: the catalog pass doubles as the
   * re-plan signal for every show in progress (playheads are read live by the planner).
   */
  private async listRequests(account: CatalogAccount, kind: RequestReason): Promise<MediaInfos[]> {
    const medias = (await this.catalog.listRequests(account, kind)).map(toMediaInfos);
    if (kind === RequestReason.Progress) {
      const imdbIds = _.uniq(medias.map((media) => media.imdbId).filter(Boolean));
      imdbIds.forEach((imdbId) => this.planner.schedulePass({ kind: 'show', imdbId }));
    }
    return medias;
  }

  // --- Per-media sync ---

  private async syncRequestReasons(
    request: SyncRequestSnapshot,
    desiredKindsByUserId: Record<UserEntity['id'], Set<RequestReason>>,
    syncedKindsByUserId: Record<UserEntity['id'], Set<RequestReason>>,
  ): Promise<void> {
    const existingReasonsByUserId = new Map(
      (request.userReasons ?? []).map((ur) => [ur.userId, new Set(<RequestReason[]>ur.reasons)]),
    );

    for (const [userId, concernedKinds] of Object.entries(syncedKindsByUserId)) {
      const desiredKinds = desiredKindsByUserId[userId] ?? new Set<RequestReason>();
      const existingKinds = existingReasonsByUserId.get(userId) ?? new Set<RequestReason>();

      for (const kind of concernedKinds) {
        if (desiredKinds.has(kind) && !existingKinds.has(kind)) {
          await this.requestsRepository.setUserRequestReason(request.mediaId, userId, kind);
        } else if (!desiredKinds.has(kind) && existingKinds.has(kind)) {
          await this.requestsRepository.removeUserRequestReason(request.mediaId, userId, kind);
        }
      }
    }
  }

  /** Request creation only writes intent; the planner reacts to the NOTIFY events. */
  private async processNewRequest(desiredMedia: DesiredMedia): Promise<string | null> {
    try {
      const media = await this.mediasRepository.upsert(desiredMedia.mediaInfos);
      await this.requestsRepository.upsert(media.id, RequestStatus.Missing);

      for (const [userId, reasons] of Object.entries(desiredMedia.requestKindsByUserId)) {
        await this.requestsRepository.setUserRequestReasons(media.id, userId, reasons);
      }
      return media.id;
    } catch (error) {
      CatalogSyncService.logger.error(
        `Failed to create request for "${desiredMedia.mediaInfos.title}" (${desiredMedia.mediaInfos.imdbId}): ${error instanceof Error ? error.message : error}`,
      );
      return null;
    }
  }

  /**
   * A catalog sometimes has no IMDb id for a title; the planner can never search those.
   * One ticket per title lets the admin unblock the group by replying the id.
   */
  private async openMissingImdbTickets(
    gathered: GatheredData,
    mediaIdByKey: Record<MediaCompositeKey, string>,
  ): Promise<void> {
    const orphanGroups = _.groupBy(
      Object.entries(gathered.desiredMediaByKey).filter(([, d]) => d.mediaInfos.imdbId === ''),
      ([, d]) => `${d.mediaInfos.type}:${d.mediaInfos.title}:${d.mediaInfos.year ?? ''}`,
    );

    for (const entries of Object.values(orphanGroups)) {
      const { title, year, type } = entries[0][1].mediaInfos;
      const mediaIds = entries.map(([key]) => mediaIdByKey[key]).filter((id): id is string => !!id);
      if (mediaIds.length === 0) {
        continue;
      }

      const kind = type === MediaType.Movie ? ('movie' as const) : ('show' as const);
      const subject =
        kind === 'movie'
          ? { type: 'media' as const, id: mediaIds[0] }
          : { type: 'show' as const, id: `${title}:${year ?? ''}`.toLowerCase().slice(0, 64) };

      await this.ticketService.open(
        TicketCategory.MissingImdb,
        subject,
        { title, year, kind, mediaIds },
        { title: `IMDb inconnu — ${title}${year ? ` (${year})` : ''}` },
      );
    }
  }

  // --- Incremental scheduling ---

  private async getKindsToSync(userId: string, account: CatalogAccount): Promise<Set<RequestReason>> {
    const lastSyncByKind = await this.userActivitiesRepository.getForUserId(userId);
    const kinds = [...this.catalog.reasons];

    const fullSyncCutoff = DateTime.now().minus({ hours: this.config.fullSyncIntervalHours });
    if (kinds.some((kind) => !lastSyncByKind[kind] || lastSyncByKind[kind] < fullSyncCutoff)) {
      CatalogSyncService.logger.log(
        `User ${userId}: forcing full sync (no kind synced within ${this.config.fullSyncIntervalHours}h)`,
      );
      return new Set(kinds);
    }

    const activity = await this.catalog.lastActivity(account);
    return new Set(
      kinds.filter((kind) => {
        const lastSync = lastSyncByKind[kind];
        const updatedAt = activity[kind];
        return !lastSync || !updatedAt || DateTime.fromJSDate(updatedAt) > lastSync;
      }),
    );
  }
}
