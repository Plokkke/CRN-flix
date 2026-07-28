import { Indexer } from './contract';
import { HydrackerApi, HydrackerConfig } from './hydracker/api';
import { HydrackerIndexer } from './hydracker/indexer';
import { LoadixApi, LoadixConfig } from './loadix/api';
import { LoadixIndexer } from './loadix/indexer';

export type IndexersConfig = {
  hydracker: HydrackerConfig | null;
  loadix: LoadixConfig | null;
};

export function createIndexers(config: IndexersConfig, serviceName: string): Indexer[] {
  const indexers: Indexer[] = [];

  if (config.hydracker) {
    indexers.push(new HydrackerIndexer(new HydrackerApi(config.hydracker, serviceName), config.hydracker.host));
  }

  if (config.loadix) {
    indexers.push(new LoadixIndexer(new LoadixApi(config.loadix, serviceName), config.loadix.siteHost));
  }

  return indexers;
}
