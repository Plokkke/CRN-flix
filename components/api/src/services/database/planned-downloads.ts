import { Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Pool } from 'pg';
import { z } from 'zod';

import { withDbRetry } from '@/helpers/db-retry';
import { Emitter } from '@/helpers/events';
import { ListenChannel, ListenHandle, listenWithReconnect, transaction } from '@/helpers/sql';
import { CandidateScope, IndexerCandidate } from '@/modules/indexer/contract';
import { Host, Language, Quality } from '@/modules/indexer/preferences';
import { MediaEntity } from '@/services/database/medias';
import { PlanLabel } from '@/services/planner/model';

export enum PlannedDownloadStatus {
  Proposed = 'proposed',
  Downloading = 'downloading',
  Done = 'done',
  Superseded = 'superseded',
  Expired = 'expired',
}

export const LIVE_STATUSES = [PlannedDownloadStatus.Proposed, PlannedDownloadStatus.Downloading];

export type PlannedDownloadEntity = {
  id: string;
  showImdbId: string | null;
  scope: CandidateScope;
  indexerName: string;
  url: string;
  quality: Quality;
  language: Language;
  host: Host;
  sizeBytes: number | null;
  label: PlanLabel;
  status: PlannedDownloadStatus;
  alternatives: ActionAlternative[];
  createdAt: Date;
  updatedAt: Date;
  coveredMediaIds: string[];
  /** Request statuses of the covered medias, aligned with nothing in particular. */
  coveredStatuses: string[];
  medias?: MediaEntity[];
  userNames?: string[];
};

/** Compact runner-up shown on the admin embed. */
export type ActionAlternative = {
  indexerName: string;
  url: string;
  scope: CandidateScope;
  quality: string;
  language: string;
  sizeBytes: number | null;
};

export type NewPlannedDownload = {
  showImdbId: string | null;
  candidate: IndexerCandidate;
  label: PlanLabel;
  alternatives: ActionAlternative[];
  coveredMediaIds: string[];
};

type PlannedDownloadRecord = {
  id: string;
  show_imdb_id: string | null;
  scope: 'movie' | 'episode' | 'season' | 'series';
  season_number: number | null;
  episode_number: number | null;
  indexer_name: string;
  url: string;
  quality: string;
  language: string;
  host: string;
  size_bytes: string | number | null;
  label: PlanLabel;
  status: PlannedDownloadStatus;
  alternatives: ActionAlternative[];
  created_at: Date;
  updated_at: Date;
  covered_media_ids?: string[];
  covered_statuses?: string[];
  medias?: MediaEntity[];
  user_names?: string[];
};

function toScope(record: Pick<PlannedDownloadRecord, 'scope' | 'season_number' | 'episode_number'>): CandidateScope {
  switch (record.scope) {
    case 'movie':
      return { kind: 'movie' };
    case 'series':
      return { kind: 'series' };
    case 'season':
      return { kind: 'season', season: record.season_number ?? 0 };
    case 'episode':
      return { kind: 'episode', season: record.season_number ?? 0, episode: record.episode_number ?? 0 };
  }
}

function scopeColumns(scope: CandidateScope): {
  scope: string;
  seasonNumber: number | null;
  episodeNumber: number | null;
} {
  return {
    scope: scope.kind,
    seasonNumber: scope.kind === 'season' || scope.kind === 'episode' ? scope.season : null,
    episodeNumber: scope.kind === 'episode' ? scope.episode : null,
  };
}

function fromRecord(record: PlannedDownloadRecord): PlannedDownloadEntity {
  return {
    id: record.id,
    showImdbId: record.show_imdb_id,
    scope: toScope(record),
    indexerName: record.indexer_name,
    url: record.url,
    quality: record.quality as Quality,
    language: record.language as Language,
    host: record.host as Host,
    sizeBytes: record.size_bytes === null ? null : Number(record.size_bytes),
    label: record.label,
    status: record.status,
    alternatives: record.alternatives ?? [],
    createdAt: record.created_at,
    updatedAt: record.updated_at,
    coveredMediaIds: record.covered_media_ids ?? [],
    coveredStatuses: record.covered_statuses ?? [],
    medias: record.medias,
    userNames: record.user_names,
  };
}

const stringParseMorphing = z.string().transform((payload): unknown => JSON.parse(payload));

const actionCreatedEventSchema = z.object({ actionId: z.string() });
export type PlannedDownloadCreatedEvent = z.infer<typeof actionCreatedEventSchema>;

const actionStatusChangedEventSchema = z.object({
  actionId: z.string(),
  oldStatus: z.enum(PlannedDownloadStatus),
  newStatus: z.enum(PlannedDownloadStatus),
});
export type PlannedDownloadStatusChangedEvent = z.infer<typeof actionStatusChangedEventSchema>;

const actionLabelChangedEventSchema = z.object({
  actionId: z.string(),
  oldLabel: z.enum(PlanLabel),
  newLabel: z.enum(PlanLabel),
});
export type PlannedDownloadLabelChangedEvent = z.infer<typeof actionLabelChangedEventSchema>;

export type PlannedDownloadEvents = {
  created: PlannedDownloadCreatedEvent;
  statusChange: PlannedDownloadStatusChangedEvent;
  labelChange: PlannedDownloadLabelChangedEvent;
};

const DETAILS_SELECT = `
  SELECT
    pd.*,
    COALESCE(
      (SELECT array_agg(pdm.media_id) FROM planned_download_medias pdm WHERE pdm.planned_download_id = pd.id),
      '{}'
    ) AS covered_media_ids,
    COALESCE(
      (SELECT array_agg(mr.status)
       FROM planned_download_medias pdm
       JOIN media_requests mr ON mr.media_id = pdm.media_id
       WHERE pdm.planned_download_id = pd.id),
      '{}'
    ) AS covered_statuses,
    (
      SELECT COALESCE(json_agg(json_build_object(
        'id', m.id,
        'imdbId', m.imdb_id,
        'type', m.type,
        'title', m.title,
        'originalTitle', m.original_title,
        'frenchTitle', m.french_title,
        'originalLanguage', m.original_language,
        'year', m.year,
        'seasonNumber', m.season_number,
        'episodeNumber', m.episode_number,
        'runtimeMinutes', m.runtime_minutes,
        'traktSlug', m.trakt_slug
      ) ORDER BY m.season_number, m.episode_number), '[]'::json)
      FROM planned_download_medias pdm
      JOIN medias m ON m.id = pdm.media_id
      WHERE pdm.planned_download_id = pd.id
    ) AS medias,
    (
      SELECT COALESCE(array_agg(DISTINCT u.name), '{}')
      FROM planned_download_medias pdm
      JOIN request_users ru ON ru.request_media_id = pdm.media_id
      JOIN users u ON u.id = ru.user_id
      WHERE pdm.planned_download_id = pd.id
    ) AS user_names
  FROM planned_downloads pd
`;

export class PlannedDownloadsRepository
  extends Emitter<PlannedDownloadEvents>
  implements OnModuleInit, OnModuleDestroy
{
  static readonly logger = new Logger(PlannedDownloadsRepository.name);

  private listenHandle: ListenHandle | null = null;

  constructor(private readonly pool: Pool) {
    super();
  }

  onModuleInit(): void {
    const channels: ListenChannel[] = [
      {
        channel: 'planned_download_created',
        schema: stringParseMorphing.pipe(actionCreatedEventSchema),
        callback: (msg) => this.emit('created', msg as PlannedDownloadCreatedEvent),
      },
      {
        channel: 'planned_download_status_changed',
        schema: stringParseMorphing.pipe(actionStatusChangedEventSchema),
        callback: (msg) => this.emit('statusChange', msg as PlannedDownloadStatusChangedEvent),
      },
      {
        channel: 'planned_download_label_changed',
        schema: stringParseMorphing.pipe(actionLabelChangedEventSchema),
        callback: (msg) => this.emit('labelChange', msg as PlannedDownloadLabelChangedEvent),
      },
    ];
    this.listenHandle = listenWithReconnect(this.pool, channels, undefined, 'PlannedDownloadsRepository');
  }

  async onModuleDestroy(): Promise<void> {
    if (this.listenHandle) {
      await this.listenHandle.close();
      this.listenHandle = null;
    }
  }

  async create(action: NewPlannedDownload): Promise<string> {
    const { scope, seasonNumber, episodeNumber } = scopeColumns(action.candidate.scope);
    let actionId = '';

    await transaction(this.pool, async (client) => {
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO planned_downloads
           (show_imdb_id, scope, season_number, episode_number, indexer_name, url, quality, language, host, size_bytes, label, alternatives)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         RETURNING id`,
        [
          action.showImdbId,
          scope,
          seasonNumber,
          episodeNumber,
          action.candidate.indexerName,
          action.candidate.url,
          action.candidate.quality,
          action.candidate.language,
          action.candidate.host,
          action.candidate.sizeBytes,
          action.label,
          JSON.stringify(action.alternatives),
        ],
      );
      actionId = rows[0].id;

      for (const mediaId of action.coveredMediaIds) {
        await client.query(
          `INSERT INTO planned_download_medias (planned_download_id, media_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
          [actionId, mediaId],
        );
      }
    });

    return actionId;
  }

  async get(id: string): Promise<PlannedDownloadEntity | null> {
    const { rows } = await this.pool.query<PlannedDownloadRecord>(`${DETAILS_SELECT} WHERE pd.id = $1`, [id]);
    return rows.length > 0 ? fromRecord(rows[0]) : null;
  }

  async listLive(): Promise<PlannedDownloadEntity[]> {
    const { rows } = await withDbRetry(
      () =>
        this.pool.query<PlannedDownloadRecord>(`${DETAILS_SELECT} WHERE pd.status = ANY($1) ORDER BY pd.created_at`, [
          LIVE_STATUSES,
        ]),
      { label: 'plannedDownloads.listLive' },
    );
    return rows.map(fromRecord);
  }

  async updateStatus(id: string, status: PlannedDownloadStatus): Promise<void> {
    await this.pool.query(`UPDATE planned_downloads SET status = $2 WHERE id = $1`, [id, status]);
  }

  async updateLabel(id: string, label: PlanLabel): Promise<void> {
    await this.pool.query(`UPDATE planned_downloads SET label = $2 WHERE id = $1`, [id, label]);
  }

  /** Re-plan refresh: the action identity (scope) stays, its best candidate may change. */
  async refreshCandidate(
    id: string,
    candidate: IndexerCandidate,
    label: PlanLabel,
    alternatives: ActionAlternative[],
    coveredMediaIds: string[],
  ): Promise<void> {
    await transaction(this.pool, async (client) => {
      await client.query(
        `UPDATE planned_downloads
         SET indexer_name = $2, url = $3, quality = $4, language = $5, host = $6, size_bytes = $7, label = $8, alternatives = $9
         WHERE id = $1`,
        [
          id,
          candidate.indexerName,
          candidate.url,
          candidate.quality,
          candidate.language,
          candidate.host,
          candidate.sizeBytes,
          label,
          JSON.stringify(alternatives),
        ],
      );
      await client.query(`DELETE FROM planned_download_medias WHERE planned_download_id = $1 AND media_id != ALL($2)`, [
        id,
        coveredMediaIds,
      ]);
      for (const mediaId of coveredMediaIds) {
        await client.query(
          `INSERT INTO planned_download_medias (planned_download_id, media_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
          [id, mediaId],
        );
      }
    });
  }
}
