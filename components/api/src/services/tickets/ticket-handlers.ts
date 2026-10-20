import { Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { AxiosError } from 'axios';

import { AccountNameTakenError, Downloader, IdentifiedMedia, LiveDownload, Player } from '@crn-flix/contracts';

import { Listener } from '@/helpers/events';
import { DownloadJobsRepository } from '@/services/database/download-jobs';
import { MediaEntity, MediasRepository, MediaType } from '@/services/database/medias';
import { PlannedDownloadsRepository, PlannedDownloadStatus } from '@/services/database/planned-downloads';
import { RequestsRepository, RequestStatus } from '@/services/database/requests';
import { TicketNotifyEvents, TicketsRepository } from '@/services/database/tickets';
import { UserEntity, UsersRepository, UserStatus } from '@/services/database/users';
import { buildDownloadMetadata } from '@/services/downloads/metadata';
import { MediaIdentifierService } from '@/services/media-identifier';
import { AllUserMessaging, UserMessagingCtxt } from '@/services/messaging/user/all';
import { buildActionDownloadMetadata, PlannerService } from '@/services/planner/planner';
import { PlayerAccountsService } from '@/services/player-accounts';
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

type Identification = IdentifiedMedia;
type ManualDownloadPayload = TicketPayloadMap[TicketCategory.ManualDownload];

function labelOf(identification: Identification): string {
  return `${identification.title}${identification.year ? ` (${identification.year})` : ''}`;
}

const describeError = (error: unknown): string => (error instanceof Error ? error.message : String(error));

const messagingContextOf = (user: UserEntity): UserMessagingCtxt => ({ key: user.messagingKey, id: user.messagingId });

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
    private readonly player: Player,
    private readonly messaging: AllUserMessaging,
    private readonly usersRepository: UsersRepository,
    private readonly requestsRepository: RequestsRepository,
    private readonly mediasRepository: MediasRepository,
    private readonly plannedDownloads: PlannedDownloadsRepository,
    private readonly postDownloadPipeline: PostDownloadPipeline,
    private readonly downloader: Downloader,
    private readonly mediaIdentifier: MediaIdentifierService,
    private readonly planner: PlannerService,
    private readonly downloadJobs: DownloadJobsRepository,
    private readonly playerAccounts: PlayerAccountsService,
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
    return operation.kind === 'reject' ? this.rejectUser(user) : this.approveUser(user);
  }

  /** The user is only deleted once told: a refusal that could not be sent keeps the ticket open. */
  private async rejectUser(user: UserEntity): Promise<OperationOutcome> {
    try {
      await this.messaging.error(messagingContextOf(user), 'Votre inscription a été refusée');
    } catch (error) {
      return failed(`Refus non notifié à ${user.name} : ${describeError(error)}`.slice(0, 500));
    }
    await this.usersRepository.remove(user.id);
    return { status: 'resolved', message: `Inscription de ${user.name} refusée` };
  }

  /**
   * The user only becomes active once their credentials reached them; a retry resets the
   * password again, so a failed welcome never leaves an account nobody can log into.
   */
  private async approveUser(user: UserEntity): Promise<OperationOutcome> {
    const password = Math.random().toString(36).substring(2, 15);
    try {
      const accountId = await this.player.upsertAccount(user.name, password, user.jellyfinId);
      if (accountId !== user.jellyfinId) {
        user.jellyfinId = accountId;
        await this.usersRepository.setJellyfinId(user.id, accountId);
      }
      // Best effort: the hourly account-policy pass catches up if the player refuses now.
      await this.playerAccounts.apply(user).catch((error: unknown) => {
        TicketHandlersService.logger.warn(`Account policy not applied to ${user.name}: ${describeError(error)}`);
      });
      await this.messaging.registered(messagingContextOf(user), user, password);
      await this.usersRepository.setStatus(user.id, UserStatus.Active);
      return { status: 'resolved', message: `Inscription de ${user.name} validée` };
    } catch (error) {
      return this.approvalFailed(user, error);
    }
  }

  private async approvalFailed(user: UserEntity, error: unknown): Promise<OperationOutcome> {
    if (error instanceof AccountNameTakenError) {
      await this.tellUser(user, "Ce nom d'utilisateur existe déjà merci d'en choisir un autre");
      return failed(`Le nom "${user.name}" existe déjà sur ${this.player.name}`);
    }
    const message = error instanceof AxiosError ? JSON.stringify(error.response?.data) : describeError(error);
    TicketHandlersService.logger.error(`Error registering user ${user.name}: ${message}`);
    return failed(`Inscription de ${user.name} non finalisée : ${message}`.slice(0, 500));
  }

  /** Best effort: the ticket already reports the failure to the admin. */
  private async tellUser(user: UserEntity, message: string): Promise<void> {
    await this.messaging.error(messagingContextOf(user), message).catch((error: unknown) => {
      TicketHandlersService.logger.warn(`Could not tell ${user.name} "${message}": ${describeError(error)}`);
    });
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
        if (!(await this.downloader.canHandle(operation.url))) {
          return failed('Le downloader ne gère pas ce lien');
        }
        this.downloader.download(operation.url, buildActionDownloadMetadata(action));
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
      const identification = await this.mediaIdentifier.identifyImdbId(operation.imdbId);
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
      const resolved = await this.downloader.resolve(url);
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

  private findInFlightDownload(ticketId: string): LiveDownload | undefined {
    return this.downloader
      .liveDownloads()
      .find((d) => d.metadata?.[TICKET_ID_METADATA_KEY] === ticketId && !SETTLED_DOWNLOAD_STATUSES.has(d.status));
  }

  private async ensurePendingRequest(identification: Identification): Promise<MediaEntity> {
    const media = await this.mediasRepository.upsert({
      imdbId: identification.imdbId,
      type: identification.kind === 'movie' ? MediaType.Movie : MediaType.Episode,
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

    this.downloader.download(url, this.downloadMetadata(ticket, media));

    TicketHandlersService.logger.log(`Download launched for "${identification.title}" (ticket ${ticket.id})`);
    return {
      status: 'progress',
      message: `Identifié : ${labelOf(identification)} — téléchargement lancé`,
      payloadPatch: { url, imdbId: identification.imdbId, requestId: media.id, lastError: null },
    };
  }

  /**
   * The download is still running in the downloader: keep it, swap its metadata for the corrected
   * identity, re-point the ticket at the right request (the post-download pipeline also reads it,
   * covering a downloader that did not apply the update) and drop the misidentified request when
   * nobody else asked for it.
   */
  private async reidentifyInFlightDownload(
    ticket: TicketEntity,
    inFlight: LiveDownload,
    payload: ManualDownloadPayload,
    identification: Identification,
  ): Promise<OperationOutcome> {
    const media = await this.ensurePendingRequest(identification);
    this.downloader.updateMetadata(inFlight.id, this.downloadMetadata(ticket, media));

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
