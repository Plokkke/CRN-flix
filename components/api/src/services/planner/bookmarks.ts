import { Logger } from '@nestjs/common';
import * as _ from 'lodash';

import { Indexer, IndexerBookmark, IndexerCandidate, IndexerTarget, targetImdbId } from '@/modules/indexer/contract';
import { EnginePreferences } from '@/modules/indexer/preferences';

export type BookmarkStore = {
  listByImdbId(imdbId: string): Promise<Map<string, IndexerBookmark>>;
  save(indexerName: string, imdbId: string, bookmark: IndexerBookmark | null): Promise<void>;
};

export type IndexersFindings = {
  candidates: IndexerCandidate[];
  /** At least one indexer has a page for the media (bookmark with a pageUrl). */
  referenced: boolean;
};

/**
 * Runs every indexer with the bookmark it left last time and stores what it hands back.
 * An indexer failure or a storage failure never hides the other indexers' candidates.
 */
export async function findAcrossIndexers(
  indexers: Indexer[],
  target: IndexerTarget,
  prefs: EnginePreferences,
  store: BookmarkStore,
  logger: Logger,
): Promise<IndexersFindings> {
  const imdbId = targetImdbId(target);
  const bookmarks = await store.listByImdbId(imdbId).catch((err: Error) => {
    logger.warn(`Could not load indexer bookmarks for ${imdbId}: ${err.message}`);
    return new Map<string, IndexerBookmark>();
  });

  const candidates: IndexerCandidate[] = [];
  let referenced = false;
  for (const indexer of indexers) {
    const before = bookmarks.get(indexer.name) ?? null;
    try {
      const result = await indexer.find(target, prefs, before);
      candidates.push(...result.candidates);
      referenced ||= typeof result.bookmark?.pageUrl === 'string';
      if (!_.isEqual(result.bookmark, before)) {
        await store.save(indexer.name, imdbId, result.bookmark);
      }
    } catch (err) {
      referenced ||= typeof before?.pageUrl === 'string';
      logger.warn(`${indexer.name}.find inconclusive for ${imdbId}: ${err instanceof Error ? err.message : err}`);
    }
  }
  return { candidates, referenced };
}
