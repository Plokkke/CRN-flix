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

export type ShelfOverride = { imdbId: string; shelf: string; origin: 'admin' | 'manual-download' };

/** The admin's choice of shared shelf, per title. */
export class ShelfOverridesRepository {
  constructor(private readonly pool: Pool) {}

  async list(): Promise<Map<string, string>> {
    const result = await this.pool.query<{ imdb_id: string; shelf: string }>(
      `SELECT imdb_id, shelf FROM shelf_overrides`,
    );
    return new Map(result.rows.map((row) => [row.imdb_id, row.shelf]));
  }

  async set(override: ShelfOverride, decidedBy: string): Promise<void> {
    await this.pool.query(
      `INSERT INTO shelf_overrides (imdb_id, shelf, origin, decided_by) VALUES ($1, $2, $3, $4)
       ON CONFLICT (imdb_id) DO UPDATE
       SET shelf = EXCLUDED.shelf, origin = EXCLUDED.origin, decided_by = EXCLUDED.decided_by, decided_at = NOW()`,
      [override.imdbId, override.shelf, override.origin, decidedBy],
    );
  }

  async clear(imdbId: string): Promise<void> {
    await this.pool.query(`DELETE FROM shelf_overrides WHERE imdb_id = $1`, [imdbId]);
  }
}
