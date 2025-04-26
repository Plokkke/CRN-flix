import { Provider } from '@nestjs/common';
import { Pool } from 'pg';

import { SYNC_DATASOURCE } from '@/providers/syncDataSource';
import { MediasRepository } from '@/services/database/medias';
import { RequestsRepository } from '@/services/database/requests';
import { UserActivitiesRepository } from '@/services/database/user-activities';
import { UsersRepository } from '@/services/database/users';

const REPOSITORIES = [UsersRepository, MediasRepository, UserActivitiesRepository];

export const repositoryProviders: Provider[] = [
  ...REPOSITORIES.map((Repository) => ({
    provide: Repository,
    inject: [SYNC_DATASOURCE],
    useFactory: async (syncDataSource: Pool): Promise<InstanceType<typeof Repository>> =>
      new Repository(syncDataSource),
  })),
  {
    provide: RequestsRepository,
    inject: [SYNC_DATASOURCE, MediasRepository],
    useFactory: async (syncDataSource: Pool, mediasRepository: MediasRepository): Promise<RequestsRepository> =>
      new RequestsRepository(syncDataSource, mediasRepository),
  },
];
