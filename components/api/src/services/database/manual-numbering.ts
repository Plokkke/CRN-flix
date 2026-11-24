import { Pool } from 'pg';

import { withDbRetry } from '@/helpers/db-retry';

/** Shows whose releases are numbered differently from the catalog: their downloads wait for the admin. */
export class ManualNumberingRepository {
  constructor(private readonly pool: Pool) {}

  async isManual(imdbId: string): Promise<boolean> {
    const result = await withDbRetry(
      () => this.pool.query(`SELECT 1 FROM manual_numbering WHERE imdb_id = $1`, [imdbId]),
      { label: 'manualNumbering.isManual' },
    );
    return (result.rowCount ?? 0) > 0;
  }

  async set(imdbId: string, actor: string): Promise<void> {
    await withDbRetry(
      () =>
        this.pool.query(
          `INSERT INTO manual_numbering (imdb_id, set_by) VALUES ($1, $2) ON CONFLICT (imdb_id) DO NOTHING`,
          [imdbId, actor],
        ),
      { label: 'manualNumbering.set' },
    );
  }

  async clear(imdbId: string): Promise<void> {
    await withDbRetry(() => this.pool.query(`DELETE FROM manual_numbering WHERE imdb_id = $1`, [imdbId]), {
      label: 'manualNumbering.clear',
    });
  }
}
