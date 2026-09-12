import { Pool } from 'pg';

import { withDbRetry } from '@/helpers/db-retry';
import { IndexerBookmark } from '@/modules/indexer/contract';

export type IndexerBookmarkEntity = IndexerBookmark & {
  indexerName: string;
  imdbId: string;
  updatedAt: Date;
};

type IndexerBookmarkRecord = {
  indexer_name: string;
  imdb_id: string;
  page_url: string | null;
  search_url: string | null;
  state: unknown;
  updated_at: Date;
};

const fromRecord = (record: IndexerBookmarkRecord): IndexerBookmarkEntity => ({
  indexerName: record.indexer_name,
  imdbId: record.imdb_id,
  pageUrl: record.page_url,
  searchUrl: record.search_url,
  state: record.state,
  updatedAt: record.updated_at,
});

/** Engine-side storage of indexer bookmarks; the content is opaque to everything but its indexer. */
export class IndexerBookmarksRepository {
  constructor(private readonly pool: Pool) {}

  async listByImdbIds(imdbIds: string[]): Promise<IndexerBookmarkEntity[]> {
    if (imdbIds.length === 0) {
      return [];
    }
    const result = await withDbRetry(
      () =>
        this.pool.query<IndexerBookmarkRecord>(
          `SELECT * FROM indexer_bookmarks WHERE imdb_id = ANY($1) ORDER BY indexer_name`,
          [imdbIds],
        ),
      { label: 'indexerBookmarks.listByImdbIds' },
    );
    return result.rows.map(fromRecord);
  }

  /** Bookmarks of one media, keyed by indexer name. */
  async listByImdbId(imdbId: string): Promise<Map<string, IndexerBookmark>> {
    const entities = await this.listByImdbIds([imdbId]);
    return new Map(
      entities.map((e) => [e.indexerName, { pageUrl: e.pageUrl, searchUrl: e.searchUrl, state: e.state }]),
    );
  }

  /** A null bookmark forgets what was stored. */
  async save(indexerName: string, imdbId: string, bookmark: IndexerBookmark | null): Promise<void> {
    if (!bookmark) {
      await withDbRetry(
        () =>
          this.pool.query(`DELETE FROM indexer_bookmarks WHERE indexer_name = $1 AND imdb_id = $2`, [
            indexerName,
            imdbId,
          ]),
        { label: 'indexerBookmarks.delete' },
      );
      return;
    }

    await withDbRetry(
      () =>
        this.pool.query(
          `INSERT INTO indexer_bookmarks (indexer_name, imdb_id, page_url, search_url, state)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (indexer_name, imdb_id) DO UPDATE
           SET page_url = EXCLUDED.page_url, search_url = EXCLUDED.search_url, state = EXCLUDED.state,
               updated_at = NOW()`,
          [indexerName, imdbId, bookmark.pageUrl, bookmark.searchUrl, JSON.stringify(bookmark.state ?? null)],
        ),
      { label: 'indexerBookmarks.save' },
    );
  }
}
