import { Provider } from '@nestjs/common';
import { Pool } from 'pg';

import { SYNC_DATASOURCE } from '@/providers/syncDataSource';
import { AdminSessionsRepository } from '@/services/database/admin-sessions';
import { DownloadJobsRepository } from '@/services/database/download-jobs';
import { MediasRepository } from '@/services/database/medias';
import { NamingAuditRepository } from '@/services/database/naming-audit';
import { RequestsRepository } from '@/services/database/requests';
import { UserActivitiesRepository } from '@/services/database/user-activities';
import { UserNotificationsRepository } from '@/services/database/user-notifications';
import { UsersRepository } from '@/services/database/users';

const REPOSITORIES = [
  UsersRepository,
  MediasRepository,
  UserActivitiesRepository,
  RequestsRepository,
  DownloadJobsRepository,
  NamingAuditRepository,
  UserNotificationsRepository,
  AdminSessionsRepository,
];

export const repositoryProviders: Provider[] = [
  ...REPOSITORIES.map((Repository) => ({
    provide: Repository,
    inject: [SYNC_DATASOURCE],
    useFactory: async (syncDataSource: Pool): Promise<InstanceType<typeof Repository>> =>
      new Repository(syncDataSource),
  })),
];
