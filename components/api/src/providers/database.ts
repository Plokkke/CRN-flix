import { Provider } from '@nestjs/common';
import { Pool } from 'pg';

import { SYNC_DATASOURCE } from '@/providers/syncDataSource';
import { AdminSessionsRepository } from '@/services/database/admin-sessions';
import { DownloadJobsRepository } from '@/services/database/download-jobs';
import { IndexerBookmarksRepository } from '@/services/database/indexer-bookmarks';
import { MediasRepository } from '@/services/database/medias';
import { NamingAuditRepository } from '@/services/database/naming-audit';
import { PlannedDownloadsRepository } from '@/services/database/planned-downloads';
import { PlannerFindingsRepository } from '@/services/database/planner-findings';
import { RequestStatesRepository } from '@/services/database/request-states';
import { RequestsRepository } from '@/services/database/requests';
import { TicketsRepository } from '@/services/database/tickets';
import { UserActivitiesRepository } from '@/services/database/user-activities';
import { UserNotificationsRepository } from '@/services/database/user-notifications';
import { UserSessionsRepository } from '@/services/database/user-sessions';
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
  UserSessionsRepository,
  PlannedDownloadsRepository,
  TicketsRepository,
  IndexerBookmarksRepository,
  RequestStatesRepository,
  PlannerFindingsRepository,
];

export const repositoryProviders: Provider[] = [
  ...REPOSITORIES.map((Repository) => ({
    provide: Repository,
    inject: [SYNC_DATASOURCE],
    useFactory: async (syncDataSource: Pool): Promise<InstanceType<typeof Repository>> =>
      new Repository(syncDataSource),
  })),
];
