import { Indexer } from '@crn-flix/contracts';
import { createLoadixIndexer, LoadixConfig } from '@crn-flix/indexer-loadix';

export type IndexersConfig = {
  loadix: LoadixConfig | null;
};

export function createIndexers(config: IndexersConfig, serviceName: string): Indexer[] {
  const indexers: Indexer[] = [];

  if (config.loadix) {
    indexers.push(createLoadixIndexer(config.loadix, serviceName));
  }

  return indexers;
}

export const INDEXERS = Symbol('Indexers');
