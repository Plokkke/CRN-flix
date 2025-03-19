import { Provider } from '@nestjs/common';
import { Pool } from 'pg';

import { SYNC_DATASOURCE } from '@/providers/syncDataSource';
import { MediaRequestRepository } from '@/services/database/mediaRequests';
import { UsersRepository } from '@/services/database/users';

const REPOSITORIES = [UsersRepository, MediaRequestRepository];

export const repositoryProviders: Provider[] = REPOSITORIES.map((Repository) => ({
  provide: Repository,
  inject: [SYNC_DATASOURCE],
  useFactory: async (syncDataSource: Pool): Promise<InstanceType<typeof Repository>> => new Repository(syncDataSource),
}));
