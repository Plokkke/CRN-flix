import { Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { AxiosError } from 'axios';

import { Listener } from '@/helpers/events';
import { JellyfinMediaService } from '@/modules/jellyfin/jellyfin';
import { DownloadJobsRepository } from '@/services/database/download-jobs';
import { MediaEntity, MediasRepository, MediaType } from '@/services/database/medias';
import { PlannedDownloadsRepository, PlannedDownloadStatus } from '@/services/database/planned-downloads';
import { RequestsRepository, RequestStatus } from '@/services/database/requests';
import { TicketNotifyEvents, TicketsRepository } from '@/services/database/tickets';
import { UsersRepository, UserStatus } from '@/services/database/users';
import { LiveDownload } from '@/services/download-live-state';
import { buildDownloadMetadata, FetchrSyncService } from '@/services/fetchr-sync';
import { MediaIdentifierService } from '@/services/media-identifier';
import { AllUserMessaging } from '@/services/messaging/user/all';
import { buildActionDownloadMetadata, PlannerService } from '@/services/planner/planner';
import { PostDownloadPipeline } from '@/services/post-download-pipeline';
import { identificationFailureResolved } from '@/services/tickets/auto-resolve';
import {
  OperationOutcome,
  TICKET_ID_METADATA_KEY,
  TicketCategory,
  TicketEntity,
  TicketOperation,
  TicketPayloadMap,
} from '@/services/tickets/model';
import { SYSTEM_ACTOR, TicketService } from '@/services/tickets/ticket.service';

export { TICKET_ID_METADATA_KEY };

const IMDB_ID_PATTERN = /^tt\d{7,}$/;
const SETTLED_DOWNLOAD_STATUSES = new Set(['completed', 'failed']);

type Identification = { imdbId: string | null; title: string; year: number | null; mediaType: 'movie' | 'episode' };
type ManualDownloadPayload = TicketPayloadMap[TicketCategory.ManualDownload];

function labelOf(identification: Identification): string {
  return `${identification.title}${identification.year ? ` (${identification.year})` : ''}`;
}

function failed(message: string, payloadPatch?: Record<string, unknown>): OperationOutcome {
  return { status: 'failed', message, payloadPatch };
}

/**
 * Category resume logic, registered on the TicketService at boot. This is the only place
 * where admin decisions touch the business services — adapters never do.
 */
export class TicketHandlersService implements OnModuleInit, OnModuleDestroy {
  private static readonly logger = new Logger(TicketHandlersService.name);

  private listener: Listener<TicketNotifyEvents> | null = null;

  constructor(
    private readonly ticketService: TicketService,
    private readonly ticketsRepository: TicketsRepository,
    private readonly jellyfin: JellyfinMediaService,
    private readonly messaging: AllUserMessaging,
    private readonly usersRepository: UsersRepository,
    private readonly requestsRepository: RequestsRepository,
    private readonly mediasRepository: MediasRepository,
    private readonly plannedDownloads: PlannedDownloadsRepository,
    private readonly postDownloadPipeline: PostDownloadPipeline,
    private readonly fetchrSync: FetchrSyncService,
    private readonly mediaIdentifier: MediaIdentifierService,
    private readonly planner: PlannerService,
    private readonly downloadJobs: DownloadJobsRepository,
  ) {}

  onModuleInit(): void {
    this.ticketService.registerHandler(TicketCategory.UserApproval, (t, op) => this.handleUserApproval(t, op));
    this.ticketService.registerHandler(TicketCategory.DownloadAction, (t, op) => this.handleDownloadAction(t, op));
    this.ticketService.registerHandler(TicketCategory.IdentificationFailure, (t, op) =>
      this.handleIdentificationFailure(t, op),
    );
    this.ticketService.registerHandler(TicketCategory.ManualDownload, (t, op) => this.handleManualDownload(t, op));
    this.ticketService.registerHandler(TicketCategory.MissingImdb, (t, op) => this.handleMissingImdb(t, op));

    // A manual download fires its first attempt as soon as the ticket exists.
    this.listener = this.ticketsRepository.listen({
      created: async ({ ticketId }) => {
        const ticket = await this.ticketsRepository.get(ticketId);
        if (ticket?.category !== TicketCategory.ManualDownload) {
          return;
        }
        const payload = ticket.payload as TicketPayloadMap[TicketCategory.ManualDownload];
        await this.ticketService.applyOperation(ticketId, { kind: 'submitLink', url: payload.url }, SYSTEM_ACTOR);
      },
    });
  }

  onModuleDestroy(): void {
    this.listener?.cleanup();
    this.listener = null;
  }

  // --- user-approval ---

  private async handleUserApproval(ticket: TicketEntity, operation: TicketOperation): Promise<OperationOutcome> {
    const payload = ticket.payload as TicketPayloadMap[TicketCategory.UserApproval];
    const user = await this.usersRepository.get(payload.userId);
    if (!user) {
      return { status: 'resolved', message: 'Utilisateur déjà supprimé' };
    }
    const messagingContext = { key: user.messagingKey, id: user.messagingId };

    if (operation.kind === 'reject') {
      this.messaging.error(messagingContext, 'Votre inscription a été refusée');
      await this.usersRepository.remove(user.id);
      return { status: 'resolved', message: `Inscription de ${user.name} refusée` };
    }

    const password = Math.random().toString(36).substring(2, 15);
    try {
      if (user.jellyfinId) {
        await this.jellyfin.resetUserPassword(user.jellyfinId, password);
      } else {
        const existing = await this.jellyfin.findUserByName(user.name);
        user.jellyfinId = existing ? existing.Id : await this.jellyfin.registerUser(user.name, password);
        if (existing) {
          await this.jellyfin.resetUserPassword(user.jellyfinId, password);
        }
        await this.usersRepository.setJellyfinId(user.id, user.jellyfinId);
      }
      await this.usersRepository.setStatus(user.id, UserStatus.Active);
      this.messaging.registered(messagingContext, user, password);
      return { status: 'resolved', message: `Inscription de ${user.name} validée` };
    } catch (error) {
      if (error instanceof Error && error.message === 'User already exists') {
        this.messaging.error(messagingContext, "Ce nom d'utilisateur existe déjà merci d'en choisir un autre");
        return failed(`Le nom "${user.name}" existe déjà sur Jellyfin`);
      }
      const message = error instanceof AxiosError ? JSON.stringify(error.response?.data) : String(error);
      TicketHandlersService.logger.error(`Error registering user ${user.name}: ${message}`);
      this.messaging.error(messagingContext, "Erreur lors de l'inscription");
      return failed(`Erreur Jellyfin : ${message}`.slice(0, 500));
    }
  }

  // --- download-action ---

  private async handleDownloadAction(ticket: TicketEntity, operation: TicketOperation): Promise<OperationOutcome> {
    const payload = ticket.payload as TicketPayloadMap[TicketCategory.DownloadAction];
    const action = await this.plannedDownloads.get(payload.actionId);
    if (!action) {
      return { status: 'resolved', message: 'Action disparue' };
    }

    switch (operation.kind) {
      case 'submitLink': {
        if (!(await this.fetchrSync.canHandle(operation.url))) {
          return failed('Aucun plugin Fetchr ne gère ce lien');
        }
        this.fetchrSync.download(operation.url, buildActionDownloadMetadata(action));
        await this.plannedDownloads.updateStatus(action.id, PlannedDownloadStatus.Downloading);
        return { status: 'progress', message: 'Téléchargement lancé sur le lien soumis' };
      }
      case 'reject':
        await this.requestsRepository.updateStatusesBulk(action.coveredMediaIds, RequestStatus.Rejected);
        this.schedulePassForAction(action.showImdbId, action.coveredMediaIds);
        return { status: 'progress', message: 'Requests couvertes rejetées' };
      case 'restore':
        await this.requestsRepository.updateStatusesBulk(action.coveredMediaIds, RequestStatus.Missing);
        this.schedulePassForAction(action.showImdbId, action.coveredMediaIds);
        return { status: 'resolved', message: 'Restaurée — le planner va replanifier' };
      default:
        return failed(`Opération ${operation.kind} inattendue`);
    }
  }

  private schedulePassForAction(showImdbId: string | null, coveredMediaIds: string[]): void {
    if (showImdbId) {
      this.planner.schedulePass({ kind: 'show', imdbId: showImdbId });
    } else if (coveredMediaIds[0]) {
      this.planner.schedulePass({ kind: 'movie', mediaId: coveredMediaIds[0] });
    }
  }

  // --- identification-failure ---

  private async handleIdentificationFailure(
    ticket: TicketEntity,
    operation: TicketOperation,
  ): Promise<OperationOutcome> {
    if (operation.kind !== 'submitImdb') {
      return failed(`Opération ${operation.kind} inattendue`);
    }
    const payload = ticket.payload as TicketPayloadMap[TicketCategory.IdentificationFailure];
    await this.postDownloadPipeline.retryWithImdbId(payload.jobId, operation.imdbId);

    const job = await this.downloadJobs.get(payload.jobId);
    if (job && identificationFailureResolved(job.status)) {
      return { status: 'resolved', message: `Identifié avec ${operation.imdbId}` };
    }
    return failed(job?.errorMessage ?? 'Le retry a échoué');
  }

  // --- manual-download ---

  private async handleManualDownload(ticket: TicketEntity, operation: TicketOperation): Promise<OperationOutcome> {
    const payload = ticket.payload as TicketPayloadMap[TicketCategory.ManualDownload];

    if (operation.kind === 'submitImdb') {
      const identification = await this.identifyFromImdbId(operation.imdbId);
      if (!identification) {
        return failed(`Aucun média TMDB pour ${operation.imdbId}`);
      }
      const inFlight = this.findInFlightDownload(ticket.id);
      if (inFlight) {
        return this.reidentifyInFlightDownload(ticket, inFlight, payload, identification);
      }
      return this.launchIdentifiedDownload(ticket, payload.url, identification);
    }

    if (operation.kind !== 'submitLink') {
      return failed(`Opération ${operation.kind} inattendue`);
    }

    const url = operation.url;
    let fileName: string;
    try {
      const resolved = await this.fetchrSync.resolve(url);
      fileName = resolved.fileName;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return failed(`Resolution echouee: ${msg}`, { url, lastError: `Resolution echouee: ${msg}` });
    }

    const parsed = this.mediaIdentifier.parseFilename(fileName);
    const identification = await this.mediaIdentifier.identifyFromParsed(parsed);
    if (!identification?.imdbId) {
      return failed(`Identification echouee pour: ${fileName}`, {
        url,
        lastError: `Identification echouee pour: ${fileName}`,
      });
    }

    return this.launchIdentifiedDownload(ticket, url, identification);
  }

  private async identifyFromImdbId(imdbId: string): Promise<Identification | null> {
    const { movies, tvShows } = await this.mediaIdentifier.tmdbFindByImdbId(imdbId);
    if (movies[0]) {
      return {
        imdbId,
        title: movies[0].title,
        year: movies[0].release_date ? parseInt(movies[0].release_date.substring(0, 4), 10) : null,
        mediaType: 'movie',
      };
    }
    if (tvShows[0]) {
      return {
        imdbId,
        title: tvShows[0].name,
        year: tvShows[0].first_air_date ? parseInt(tvShows[0].first_air_date.substring(0, 4), 10) : null,
        mediaType: 'episode',
      };
    }
    return null;
  }

  private findInFlightDownload(ticketId: string): LiveDownload | undefined {
    return this.fetchrSync
      .liveDownloads()
      .find((d) => d.metadata?.[TICKET_ID_METADATA_KEY] === ticketId && !SETTLED_DOWNLOAD_STATUSES.has(d.status));
  }

  private async ensurePendingRequest(identification: Identification): Promise<MediaEntity> {
    const media = await this.mediasRepository.upsert({
      imdbId: identification.imdbId ?? '',
      type: identification.mediaType === 'movie' ? MediaType.Movie : MediaType.Episode,
      title: identification.title,
      originalTitle: null,
      frenchTitle: null,
      originalLanguage: null,
      year: identification.year,
      seasonNumber: null,
      episodeNumber: null,
      runtimeMinutes: null,
    });
    await this.requestsRepository.upsert(media.id, RequestStatus.Pending);
    return media;
  }

  private async launchIdentifiedDownload(
    ticket: TicketEntity,
    url: string,
    identification: Identification,
  ): Promise<OperationOutcome> {
    const media = await this.ensurePendingRequest(identification);

    this.fetchrSync.download(url, this.downloadMetadata(ticket, media));

    TicketHandlersService.logger.log(`Download launched for "${identification.title}" (ticket ${ticket.id})`);
    return {
      status: 'progress',
      message: `Identifié : ${labelOf(identification)} — téléchargement lancé`,
      payloadPatch: { url, imdbId: identification.imdbId, requestId: media.id, lastError: null },
    };
  }

  /**
   * The download is still running in Fetchr: keep it, swap its metadata for the corrected
   * identity, re-point the ticket at the right request (the post-download pipeline also reads it,
   * covering a Fetchr that did not apply the update) and drop the misidentified request when
   * nobody else asked for it.
   */
  private async reidentifyInFlightDownload(
    ticket: TicketEntity,
    inFlight: LiveDownload,
    payload: ManualDownloadPayload,
    identification: Identification,
  ): Promise<OperationOutcome> {
    const media = await this.ensurePendingRequest(identification);
    this.fetchrSync.updateMetadata(inFlight.id, this.downloadMetadata(ticket, media));

    if (payload.requestId && payload.requestId !== media.id) {
      await this.dropOrphanRequest(payload.requestId);
    }

    TicketHandlersService.logger.log(`In-flight download re-identified as "${identification.title}" (${media.imdbId})`);
    return {
      status: 'progress',
      message: `Identification corrigée : ${labelOf(identification)} — le téléchargement en cours est conservé`,
      payloadPatch: { imdbId: identification.imdbId, requestId: media.id, lastError: null },
    };
  }

  private downloadMetadata(ticket: TicketEntity, media: MediaEntity): Record<string, string> {
    return { ...buildDownloadMetadata(media.id, media), [TICKET_ID_METADATA_KEY]: ticket.id };
  }

  private async dropOrphanRequest(mediaId: string): Promise<void> {
    const users = await this.requestsRepository.listUsers(mediaId);
    if (users.length === 0) {
      await this.requestsRepository.removeRequest(mediaId);
    }
  }

  // --- missing-imdb ---

  private async handleMissingImdb(ticket: TicketEntity, operation: TicketOperation): Promise<OperationOutcome> {
    if (operation.kind !== 'submitImdb') {
      return failed(`Opération ${operation.kind} inattendue`);
    }
    if (!IMDB_ID_PATTERN.test(operation.imdbId)) {
      return failed(`"${operation.imdbId}" n'est pas un IMDb ID valide (tt...)`);
    }

    const payload = ticket.payload as TicketPayloadMap[TicketCategory.MissingImdb];
    for (const mediaId of payload.mediaIds) {
      await this.mediasRepository.updateImdbId(mediaId, operation.imdbId);
    }

    if (payload.kind === 'show') {
      this.planner.schedulePass({ kind: 'show', imdbId: operation.imdbId });
    } else if (payload.mediaIds[0]) {
      this.planner.schedulePass({ kind: 'movie', mediaId: payload.mediaIds[0] });
    }

    return { status: 'resolved', message: `IMDb ${operation.imdbId} appliqué à ${payload.mediaIds.length} média(s)` };
  }
}
