import { Logger } from '@nestjs/common';
import { Pool } from 'pg';

import { withDbRetry } from '@/helpers/db-retry';

export type NamingAuditStatus = 'pending' | 'applied' | 'failed' | 'conforming';

export type NamingAuditMediaType = 'movie' | 'episode' | 'series';

export type NamingAuditItemEntity = {
  id: string;
  auditRunId: string;
  mediaType: NamingAuditMediaType;
  imdbId: string | null;
  currentPath: string;
  expectedPath: string;
  reasons: string[];
  englishTitle: string | null;
  year: number | null;
  seasonNumber: number | null;
  episodeNumber: number | null;
  status: NamingAuditStatus;
  error: string | null;
  createdAt: Date;
  appliedAt: Date | null;
};

export type NamingAuditItemInput = Omit<
  NamingAuditItemEntity,
  'id' | 'auditRunId' | 'createdAt' | 'appliedAt' | 'error'
>;

type NamingAuditItemRecord = {
  id: string;
  audit_run_id: string;
  media_type: string;
  imdb_id: string | null;
  current_path: string;
  expected_path: string;
  reasons: string[];
  english_title: string | null;
  year: number | null;
  season_number: number | null;
  episode_number: number | null;
  status: string;
  error: string | null;
  created_at: Date;
  applied_at: Date | null;
};

function mapRecord(record: NamingAuditItemRecord): NamingAuditItemEntity {
  return {
    id: record.id,
    auditRunId: record.audit_run_id,
    mediaType: record.media_type as NamingAuditMediaType,
    imdbId: record.imdb_id,
    currentPath: record.current_path,
    expectedPath: record.expected_path,
    reasons: record.reasons,
    englishTitle: record.english_title,
    year: record.year,
    seasonNumber: record.season_number,
    episodeNumber: record.episode_number,
    status: record.status as NamingAuditStatus,
    error: record.error,
    createdAt: record.created_at,
    appliedAt: record.applied_at,
  };
}

export class NamingAuditRepository {
  private static readonly logger = new Logger(NamingAuditRepository.name);

  constructor(private readonly pool: Pool) {}

  async insertRun(items: NamingAuditItemInput[]): Promise<string> {
    const { rows: runRows } = await withDbRetry(
      () => this.pool.query<{ run_id: string }>(`SELECT gen_random_uuid()::text AS run_id`),
      { label: 'namingAudit.newRunId' },
    );
    const runId = runRows[0].run_id;

    if (items.length === 0) {
      return runId;
    }

    const values: unknown[] = [];
    const placeholders: string[] = [];
    items.forEach((item, idx) => {
      const base = idx * 12;
      placeholders.push(
        `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}, $${base + 9}, $${base + 10}, $${base + 11}, $${base + 12})`,
      );
      values.push(
        runId,
        item.mediaType,
        item.imdbId,
        item.currentPath,
        item.expectedPath,
        item.reasons,
        item.englishTitle,
        item.year,
        item.seasonNumber,
        item.episodeNumber,
        item.status,
        null,
      );
    });

    await withDbRetry(
      () =>
        this.pool.query(
          `INSERT INTO naming_audit_items (
            audit_run_id, media_type, imdb_id, current_path, expected_path,
            reasons, english_title, year, season_number, episode_number, status, error
          ) VALUES ${placeholders.join(', ')}`,
          values,
        ),
      { label: 'namingAudit.insertItems' },
    );

    return runId;
  }

  async getLatestRunId(): Promise<string | null> {
    const { rows } = await withDbRetry(
      () =>
        this.pool.query<{ audit_run_id: string }>(
          `SELECT audit_run_id FROM naming_audit_items ORDER BY created_at DESC LIMIT 1`,
        ),
      { label: 'namingAudit.latestRun' },
    );
    return rows[0]?.audit_run_id ?? null;
  }

  async listByRun(runId: string): Promise<NamingAuditItemEntity[]> {
    const { rows } = await withDbRetry(
      () =>
        this.pool.query<NamingAuditItemRecord>(
          `SELECT * FROM naming_audit_items WHERE audit_run_id = $1 ORDER BY media_type, current_path`,
          [runId],
        ),
      { label: 'namingAudit.listByRun' },
    );
    return rows.map(mapRecord);
  }

  async getByIds(ids: string[]): Promise<NamingAuditItemEntity[]> {
    if (ids.length === 0) {
      return [];
    }
    const { rows } = await withDbRetry(
      () =>
        this.pool.query<NamingAuditItemRecord>(`SELECT * FROM naming_audit_items WHERE id = ANY($1::uuid[])`, [ids]),
      { label: 'namingAudit.getByIds' },
    );
    return rows.map(mapRecord);
  }

  async markApplied(id: string): Promise<void> {
    await withDbRetry(
      () => this.pool.query(`UPDATE naming_audit_items SET status = 'applied', applied_at = NOW() WHERE id = $1`, [id]),
      { label: 'namingAudit.markApplied' },
    );
  }

  async markFailed(id: string, error: string): Promise<void> {
    await withDbRetry(
      () => this.pool.query(`UPDATE naming_audit_items SET status = 'failed', error = $2 WHERE id = $1`, [id, error]),
      { label: 'namingAudit.markFailed' },
    );
  }
}
