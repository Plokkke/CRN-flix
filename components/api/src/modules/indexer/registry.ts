import { Indexer } from './contract';
import { LoadixApi, LoadixConfig } from './loadix/api';
import { LoadixIndexer } from './loadix/indexer';

export type IndexersConfig = {
  loadix: LoadixConfig | null;
};

export function createIndexers(config: IndexersConfig, serviceName: string): Indexer[] {
  const indexers: Indexer[] = [];

  if (config.loadix) {
    indexers.push(new LoadixIndexer(new LoadixApi(config.loadix, serviceName), config.loadix.siteHost));
  }

  return indexers;
}
