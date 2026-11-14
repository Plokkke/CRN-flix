import { Pool } from 'pg';

import { LibrarySection } from '@crn-flix/contracts';

import { withDbRetry } from '@/helpers/db-retry';

/** One title folder of the store. */
export type LibraryTitle = {
  section: LibrarySection;
  folder: string;
  imdbId: string;
};

export class LibraryTitlesRepository {
  constructor(private readonly pool: Pool) {}

  async record(title: LibraryTitle): Promise<void> {
    await withDbRetry(
      () =>
        this.pool.query(
          `INSERT INTO library_titles (section, folder, imdb_id) VALUES ($1, $2, $3)
           ON CONFLICT (section, folder) DO UPDATE SET imdb_id = EXCLUDED.imdb_id`,
          [title.section, title.folder, title.imdbId],
        ),
      { label: 'libraryTitles.record' },
    );
  }

  async list(): Promise<LibraryTitle[]> {
    const result = await withDbRetry(
      () =>
        this.pool.query<{ section: LibrarySection; folder: string; imdb_id: string }>(
          `SELECT section, folder, imdb_id FROM library_titles ORDER BY section, folder`,
        ),
      { label: 'libraryTitles.list' },
    );
    return result.rows.map((row) => ({ section: row.section, folder: row.folder, imdbId: row.imdb_id }));
  }
}

export type ShelfOverrideOrigin = 'admin' | 'manual-download' | 'anomaly';

export type ShelfOverride = { imdbId: string; shelf: string; origin: ShelfOverrideOrigin };

/** The admin's choice of shared shelf, per title. */
export class ShelfOverridesRepository {
  constructor(private readonly pool: Pool) {}

  async list(): Promise<Map<string, string>> {
    const result = await this.pool.query<{ imdb_id: string; shelf: string }>(
      `SELECT imdb_id, shelf FROM shelf_overrides`,
    );
    return new Map(result.rows.map((row) => [row.imdb_id, row.shelf]));
  }

  async get(imdbId: string): Promise<string | null> {
    const result = await this.pool.query<{ shelf: string }>(`SELECT shelf FROM shelf_overrides WHERE imdb_id = $1`, [
      imdbId,
    ]);
    return result.rows[0]?.shelf ?? null;
  }

  async set(override: ShelfOverride, decidedBy: string): Promise<void> {
    await this.pool.query(
      `INSERT INTO shelf_overrides (imdb_id, shelf, origin, decided_by) VALUES ($1, $2, $3, $4)
       ON CONFLICT (imdb_id) DO UPDATE
       SET shelf = EXCLUDED.shelf, origin = EXCLUDED.origin, decided_by = EXCLUDED.decided_by, decided_at = NOW()`,
      [override.imdbId, override.shelf, override.origin, decidedBy],
    );
  }

  /** A subscriber's admitted request publishes an admin's personal download; true when one was held. */
  async releaseManualHold(imdbId: string): Promise<boolean> {
    const result = await this.pool.query(
      `DELETE FROM shelf_overrides WHERE imdb_id = $1 AND shelf = 'none' AND origin = 'manual-download'`,
      [imdbId],
    );
    return (result.rowCount ?? 0) > 0;
  }

  /** Every choice, with where it came from (the admin page shows it). */
  async listAll(): Promise<ShelfOverride[]> {
    const result = await this.pool.query<{ imdb_id: string; shelf: string; origin: ShelfOverrideOrigin }>(
      `SELECT imdb_id, shelf, origin FROM shelf_overrides`,
    );
    return result.rows.map((row) => ({ imdbId: row.imdb_id, shelf: row.shelf, origin: row.origin }));
  }

  async listByOrigin(origin: ShelfOverrideOrigin): Promise<ShelfOverride[]> {
    const result = await this.pool.query<{ imdb_id: string; shelf: string }>(
      `SELECT imdb_id, shelf FROM shelf_overrides WHERE origin = $1`,
      [origin],
    );
    return result.rows.map((row) => ({ imdbId: row.imdb_id, shelf: row.shelf, origin }));
  }

  async clear(imdbId: string): Promise<void> {
    await this.pool.query(`DELETE FROM shelf_overrides WHERE imdb_id = $1`, [imdbId]);
  }
}
