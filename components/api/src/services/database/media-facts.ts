import { Pool } from 'pg';

import { MediaFacts } from '@crn-flix/contracts';

import { withDbRetry } from '@/helpers/db-retry';

export type StoredFacts = {
  facts: MediaFacts | null;
  schemaVersion: number;
  fetchedAt: Date;
};

type MediaFactsRecord = {
  facts: MediaFacts | null;
  schema_version: number;
  fetched_at: Date;
};

/** Which rows a refresh pass picks: written in another shape, or older than their freshness window. */
export type RefreshCriteria = {
  schemaVersion: number;
  knownFetchedBefore: Date;
  unknownFetchedBefore: Date;
  limit: number;
};

export class MediaFactsRepository {
  constructor(private readonly pool: Pool) {}

  async get(imdbId: string): Promise<StoredFacts | null> {
    const result = await withDbRetry(
      () =>
        this.pool.query<MediaFactsRecord>(
          `SELECT facts, schema_version, fetched_at FROM media_facts WHERE imdb_id = $1`,
          [imdbId],
        ),
      { label: 'mediaFacts.get' },
    );
    const record = result.rows[0];
    return record ? { facts: record.facts, schemaVersion: record.schema_version, fetchedAt: record.fetched_at } : null;
  }

  async save(imdbId: string, facts: MediaFacts | null, schemaVersion: number): Promise<void> {
    await withDbRetry(
      () =>
        this.pool.query(
          `INSERT INTO media_facts (imdb_id, facts, schema_version) VALUES ($1, $2, $3)
           ON CONFLICT (imdb_id) DO UPDATE
           SET facts = EXCLUDED.facts, schema_version = EXCLUDED.schema_version, fetched_at = NOW()`,
          [imdbId, facts === null ? null : JSON.stringify(facts), schemaVersion],
        ),
      { label: 'mediaFacts.save' },
    );
  }

  /** Every title of the library and the requests, never fetched first, then the stalest. */
  async listImdbIdsToRefresh(criteria: RefreshCriteria): Promise<string[]> {
    const result = await withDbRetry(
      () =>
        this.pool.query<{ imdb_id: string }>(
          `SELECT m.imdb_id
           FROM (SELECT DISTINCT imdb_id FROM medias) m
           LEFT JOIN media_facts f ON f.imdb_id = m.imdb_id
           WHERE f.imdb_id IS NULL
              OR f.schema_version <> $1
              OR (f.facts IS NOT NULL AND f.fetched_at < $2)
              OR (f.facts IS NULL AND f.fetched_at < $3)
           ORDER BY f.fetched_at ASC NULLS FIRST
           LIMIT $4`,
          [criteria.schemaVersion, criteria.knownFetchedBefore, criteria.unknownFetchedBefore, criteria.limit],
        ),
      { label: 'mediaFacts.listImdbIdsToRefresh' },
    );
    return result.rows.map((row) => row.imdb_id);
  }
}
