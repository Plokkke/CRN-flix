import { Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { TraktApi, TraktCatalog } from '@crn-flix/catalog-trakt';
import { Catalog, CatalogAccountSource } from '@crn-flix/contracts';
import { TraktPlugin } from '@crn-flix/player-jellyfin';

import { Config } from '@/app.module';
import { CatalogAccountsService } from '@/services/catalog/accounts';
import { CatalogPlayheadService } from '@/services/catalog/playheads';
import { CatalogSyncService } from '@/services/catalog/sync';
import { MediasRepository } from '@/services/database/medias';
import { RequestsRepository } from '@/services/database/requests';
import { UserActivitiesRepository } from '@/services/database/user-activities';
import { UsersRepository } from '@/services/database/users';
import { IntegrationMonitor } from '@/services/integrations/monitor';
import { PlannerService } from '@/services/planner/planner';
import { TicketService } from '@/services/tickets/ticket.service';

export const CATALOG = Symbol('Catalog');
export const CATALOG_ACCOUNT_SOURCE = Symbol('CatalogAccountSource');

export const catalogProviders: Provider[] = [
  {
    provide: CATALOG,
    inject: [TraktApi, ConfigService],
    useFactory: (api: TraktApi, configService: ConfigService<Config, true>): Catalog =>
      new TraktCatalog(api, { ratingThreshold: configService.get('sync', { infer: true }).ratingThreshold }),
  },
  {
    provide: CATALOG_ACCOUNT_SOURCE,
    useExisting: TraktPlugin,
  },
  {
    provide: CatalogAccountsService,
    inject: [UsersRepository, CATALOG_ACCOUNT_SOURCE, CATALOG],
    useFactory: (users: UsersRepository, source: CatalogAccountSource, catalog: Catalog): CatalogAccountsService =>
      new CatalogAccountsService(users, source, catalog),
  },
  {
    provide: CatalogPlayheadService,
    inject: [CatalogAccountsService, CATALOG, IntegrationMonitor],
    useFactory: (
      accounts: CatalogAccountsService,
      catalog: Catalog,
      integrations: IntegrationMonitor,
    ): CatalogPlayheadService => new CatalogPlayheadService(accounts, catalog, integrations),
  },
  {
    provide: CatalogSyncService,
    inject: [
      ConfigService,
      CATALOG,
      CatalogAccountsService,
      UserActivitiesRepository,
      MediasRepository,
      RequestsRepository,
      PlannerService,
      TicketService,
      IntegrationMonitor,
    ],
    useFactory: (
      configService: ConfigService<Config, true>,
      catalog: Catalog,
      accounts: CatalogAccountsService,
      userActivities: UserActivitiesRepository,
      medias: MediasRepository,
      requests: RequestsRepository,
      planner: PlannerService,
      tickets: TicketService,
      integrations: IntegrationMonitor,
    ): CatalogSyncService =>
      new CatalogSyncService(
        configService.get('sync'),
        catalog,
        accounts,
        userActivities,
        medias,
        requests,
        planner,
        tickets,
        integrations,
      ),
  },
];
