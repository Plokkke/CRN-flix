import { Provider } from '@nestjs/common';

import { JellyfinMediaService } from '@/modules/jellyfin/jellyfin';
import { DownloadJobsRepository } from '@/services/database/download-jobs';
import { MediasRepository } from '@/services/database/medias';
import { PlannedDownloadsRepository } from '@/services/database/planned-downloads';
import { RequestsRepository } from '@/services/database/requests';
import { TicketsRepository } from '@/services/database/tickets';
import { UsersRepository } from '@/services/database/users';
import { FetchrSyncService } from '@/services/fetchr-sync';
import { MediaIdentifierService } from '@/services/media-identifier';
import { DiscordTicketAdapter } from '@/services/messaging/admin/ticket-adapter';
import { AllUserMessaging } from '@/services/messaging/user/all';
import { PlannerService } from '@/services/planner/planner';
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
      JellyfinMediaService,
      AllUserMessaging,
      UsersRepository,
      RequestsRepository,
      MediasRepository,
      PlannedDownloadsRepository,
      PostDownloadPipeline,
      FetchrSyncService,
      MediaIdentifierService,
      PlannerService,
      DownloadJobsRepository,
    ],
    useFactory: (
      ticketService: TicketService,
      ticketsRepository: TicketsRepository,
      jellyfin: JellyfinMediaService,
      messaging: AllUserMessaging,
      usersRepository: UsersRepository,
      requestsRepository: RequestsRepository,
      mediasRepository: MediasRepository,
      plannedDownloads: PlannedDownloadsRepository,
      postDownloadPipeline: PostDownloadPipeline,
      fetchrSync: FetchrSyncService,
      mediaIdentifier: MediaIdentifierService,
      planner: PlannerService,
      downloadJobs: DownloadJobsRepository,
    ): TicketHandlersService =>
      new TicketHandlersService(
        ticketService,
        ticketsRepository,
        jellyfin,
        messaging,
        usersRepository,
        requestsRepository,
        mediasRepository,
        plannedDownloads,
        postDownloadPipeline,
        fetchrSync,
        mediaIdentifier,
        planner,
        downloadJobs,
      ),
  },
  {
    provide: TicketReconcilerService,
    inject: [TicketsRepository, DiscordTicketAdapter],
    useFactory: (tickets: TicketsRepository, adapter: DiscordTicketAdapter): TicketReconcilerService =>
      new TicketReconcilerService(tickets, adapter),
  },
];
