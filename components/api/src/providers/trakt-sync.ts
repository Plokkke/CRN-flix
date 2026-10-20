import { ConfigService } from '@nestjs/config';

import { TraktApi } from '@crn-flix/catalog-trakt';
import { TraktPlugin } from '@crn-flix/player-jellyfin';

import { Config } from '@/app.module';
import { MediasRepository } from '@/services/database/medias';
import { RequestsRepository } from '@/services/database/requests';
import { UserActivitiesRepository } from '@/services/database/user-activities';
import { UsersRepository } from '@/services/database/users';
import { PlannerService } from '@/services/planner/planner';
import { TicketService } from '@/services/tickets/ticket.service';
import { TraktSyncService } from '@/services/trakt-sync';

export const traktSyncProvider = {
  provide: TraktSyncService,
  inject: [
    ConfigService,
    TraktPlugin,
    TraktApi,
    UsersRepository,
    UserActivitiesRepository,
    MediasRepository,
    RequestsRepository,
    PlannerService,
    TicketService,
  ],
  useFactory: (
    configService: ConfigService<Config, true>,
    traktPlugin: TraktPlugin,
    traktApi: TraktApi,
    usersRepository: UsersRepository,
    userActivitySyncsRepository: UserActivitiesRepository,
    mediasRepository: MediasRepository,
    requestsRepository: RequestsRepository,
    planner: PlannerService,
    ticketService: TicketService,
  ): TraktSyncService => {
    return new TraktSyncService(
      configService.get('sync'),
      traktPlugin,
      traktApi,
      usersRepository,
      userActivitySyncsRepository,
      mediasRepository,
      requestsRepository,
      planner,
      ticketService,
    );
  },
};
