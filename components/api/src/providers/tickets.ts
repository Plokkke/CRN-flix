import { Provider } from '@nestjs/common';

import { Downloader, Player } from '@crn-flix/contracts';

import { DOWNLOADER } from '@/providers/downloader';
import { PLAYER } from '@/providers/player';
import { DownloadJobsRepository } from '@/services/database/download-jobs';
import { MediasRepository } from '@/services/database/medias';
import { PlannedDownloadsRepository } from '@/services/database/planned-downloads';
import { RequestsRepository } from '@/services/database/requests';
import { TicketsRepository } from '@/services/database/tickets';
import { UsersRepository } from '@/services/database/users';
import { IntegrationMonitor } from '@/services/integrations/monitor';
import { MediaIdentifierService } from '@/services/media-identifier';
import { AdminTicketRelay } from '@/services/messaging/admin/relay';
import { AllUserMessaging } from '@/services/messaging/user/all';
import { PlannerService } from '@/services/planner/planner';
import { PlayerAccountsService } from '@/services/player-accounts';
import { PostDownloadPipeline } from '@/services/post-download-pipeline';
import { TicketContextLoader } from '@/services/tickets/context';
import { TicketReconcilerService } from '@/services/tickets/reconciler';
import { TicketHandlersService } from '@/services/tickets/ticket-handlers';
import { TicketService } from '@/services/tickets/ticket.service';

export const ticketProviders: Provider[] = [
  {
    provide: TicketService,
    inject: [TicketsRepository],
    useFactory: (tickets: TicketsRepository): TicketService => new TicketService(tickets),
  },
  {
    provide: IntegrationMonitor,
    inject: [TicketsRepository, TicketService],
    useFactory: (tickets: TicketsRepository, ticketService: TicketService): IntegrationMonitor =>
      new IntegrationMonitor(tickets, ticketService),
  },
  {
    provide: TicketContextLoader,
    inject: [PlannedDownloadsRepository, UsersRepository],
    useFactory: (plannedDownloads: PlannedDownloadsRepository, users: UsersRepository): TicketContextLoader =>
      new TicketContextLoader(plannedDownloads, users),
  },
  {
    provide: TicketHandlersService,
    inject: [
      TicketService,
      TicketsRepository,
      PLAYER,
      AllUserMessaging,
      UsersRepository,
      RequestsRepository,
      MediasRepository,
      PlannedDownloadsRepository,
      PostDownloadPipeline,
      DOWNLOADER,
      MediaIdentifierService,
      PlannerService,
      DownloadJobsRepository,
      PlayerAccountsService,
    ],
    useFactory: (
      ticketService: TicketService,
      ticketsRepository: TicketsRepository,
      player: Player,
      messaging: AllUserMessaging,
      usersRepository: UsersRepository,
      requestsRepository: RequestsRepository,
      mediasRepository: MediasRepository,
      plannedDownloads: PlannedDownloadsRepository,
      postDownloadPipeline: PostDownloadPipeline,
      downloader: Downloader,
      mediaIdentifier: MediaIdentifierService,
      planner: PlannerService,
      downloadJobs: DownloadJobsRepository,
      playerAccounts: PlayerAccountsService,
    ): TicketHandlersService =>
      new TicketHandlersService(
        ticketService,
        ticketsRepository,
        player,
        messaging,
        usersRepository,
        requestsRepository,
        mediasRepository,
        plannedDownloads,
        postDownloadPipeline,
        downloader,
        mediaIdentifier,
        planner,
        downloadJobs,
        playerAccounts,
      ),
  },
  {
    provide: TicketReconcilerService,
    inject: [TicketsRepository, AdminTicketRelay],
    useFactory: (tickets: TicketsRepository, relay: AdminTicketRelay): TicketReconcilerService =>
      new TicketReconcilerService(tickets, relay),
  },
];
