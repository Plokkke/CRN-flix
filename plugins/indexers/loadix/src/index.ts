import { Indexer } from '@crn-flix/contracts';

import { LoadixApi, LoadixConfig } from './api';
import { LoadixIndexer } from './indexer';

export { configSchema as loadixConfigSchema, LoadixApi, LoadixConfig } from './api';
export { LoadixIndexer } from './indexer';

export function createLoadixIndexer(config: LoadixConfig, serviceName: string): Indexer {
  return new LoadixIndexer(new LoadixApi(config, serviceName), config.siteHost);
}
