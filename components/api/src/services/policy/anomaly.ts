import { Logger, OnModuleInit } from '@nestjs/common';

import { TicketOperation } from '@crn-flix/contracts';
import { Placement } from '@crn-flix/policy';

import { LibraryTitlesRepository, ShelfOverridesRepository } from '@/services/database/library';
import { displayTitle, MediasRepository } from '@/services/database/medias';
import { PolicyExemptionsRepository } from '@/services/database/policy';
import { TicketsRepository } from '@/services/database/tickets';
import { OperationOutcome, TicketCategory, TicketEntity, TicketPayloadMap } from '@/services/tickets/model';
import { TicketService } from '@/services/tickets/ticket.service';

import { PolicyService } from './policy';

type AnomalyPayload = TicketPayloadMap[TicketCategory.PolicyAnomaly];

/** A title the shelves are about to take off a shared shelf. */
export type Unshelving = { imdbId: string; shelf: string };

/** What a decision needs from the library. */
export type AnomalyLibrary = {
  reconcile: () => Promise<void>;
  /** Deletes the title's files; returns how many store folders went. */
  discard: (imdbId: string) => Promise<number>;
};

const SUBJECT_TYPE = 'media';

const describeError = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/**
 * Retroactivity: a title already on a shared shelf that a rule for everyone now refuses is
 * not taken down silently. It stays where it is (a shelf override of origin `anomaly`) and a
 * `policy-anomaly` ticket asks the admin to exclude it from the rules or take it down. The
 * ticket resolves itself once the title breaks no rule anymore or its files are gone. Taking
 * it down deletes its files: storage is not kept for a title nobody can reach.
 */
export class PolicyAnomalies implements OnModuleInit {
  private static readonly logger = new Logger(PolicyAnomalies.name);

  private library: AnomalyLibrary = { reconcile: async () => {}, discard: async () => 0 };

  constructor(
    private readonly policy: PolicyService,
    private readonly tickets: TicketService,
    private readonly ticketsRepository: TicketsRepository,
    private readonly overrides: ShelfOverridesRepository,
    private readonly exemptions: PolicyExemptionsRepository,
    private readonly medias: MediasRepository,
    private readonly titles: LibraryTitlesRepository,
  ) {}

  onModuleInit(): void {
    this.tickets.registerHandler(TicketCategory.PolicyAnomaly, (ticket, operation, actor) =>
      this.handle(ticket, operation, actor),
    );
  }

  /** Wired by the library, which depends on this service: the shelves follow a decision, a take-down deletes the files. */
  wire(library: AnomalyLibrary): void {
    this.library = library;
  }

  /** Keeps every leaving title the rules now restrict where it is, with a ticket; returns the ones kept. */
  async freeze(leaving: Unshelving[]): Promise<Set<string>> {
    const frozen = new Set<string>();
    for (const { imdbId, shelf } of leaving) {
      if (frozen.has(imdbId) || (await this.overrides.get(imdbId)) !== null) {
        continue;
      }
      const placement = await this.policy.placementOf(imdbId).catch(() => null);
      if (placement?.kind === 'restricted') {
        await this.open(imdbId, shelf, placement);
        frozen.add(imdbId);
      }
    }
    return frozen;
  }

  /** Lets go of what no longer needs a human: title fine again, files gone, ticket closed. */
  async sweep(): Promise<void> {
    const held = await this.overrides.listByOrigin('anomaly');
    if (held.length === 0) {
      return;
    }
    const stored = new Set((await this.titles.list()).map((title) => title.imdbId));
    for (const { imdbId, shelf } of held) {
      const ticket = await this.ticketsRepository.getOpenBySubject(TicketCategory.PolicyAnomaly, SUBJECT_TYPE, imdbId);
      const takenDown = shelf === 'none';
      const placement = await this.policy.placementOf(imdbId).catch(() => null);
      const reason = !stored.has(imdbId)
        ? 'Fichiers retirés du stock'
        : placement && placement.kind !== 'restricted'
          ? 'Le titre ne viole plus aucune règle'
          : null;
      if (reason || (!ticket && !takenDown)) {
        await this.overrides.clear(imdbId);
      }
      if (ticket && reason) {
        await this.tickets.resolveById(ticket.id, reason);
      }
    }
  }

  private async open(
    imdbId: string,
    shelf: string,
    placement: Extract<Placement, { kind: 'restricted' }>,
  ): Promise<void> {
    const media = await this.medias.firstOf(imdbId);
    const title = media ? displayTitle(media) : imdbId;
    await this.overrides.set({ imdbId, shelf, origin: 'anomaly' }, 'system');
    await this.tickets.open(
      TicketCategory.PolicyAnomaly,
      { type: SUBJECT_TYPE, id: imdbId },
      {
        imdbId,
        title,
        shelf,
        refusals: placement.refusals.map(({ ruleId, ruleName, summary }) => ({ ruleId, ruleName, summary })),
      },
      { title: `Anomalie — ${title} enfreint désormais une règle` },
    );
    PolicyAnomalies.logger.log(`Anomaly: ${imdbId} kept on ${shelf} until an admin decides`);
  }

  private async handle(ticket: TicketEntity, operation: TicketOperation, actor: string): Promise<OperationOutcome> {
    const { imdbId, refusals } = ticket.payload as AnomalyPayload;
    if (operation.kind === 'excludeTitle') {
      const ruleIds = refusals.flatMap((refusal) => (refusal.ruleId ? [refusal.ruleId] : []));
      await this.exemptions.grantGlobal(imdbId, ruleIds, 'admin', actor);
      await this.overrides.clear(imdbId);
      await this.library.reconcile().catch((error: unknown) => {
        PolicyAnomalies.logger.warn(`Shelves after anomaly on ${imdbId}: ${describeError(error)}`);
      });
      return { status: 'resolved', message: 'Titre exclu des règles, il reste visible' };
    }
    if (operation.kind !== 'unpublish') {
      return { status: 'failed', message: `Opération ${operation.kind} non gérée` };
    }
    await this.overrides.clear(imdbId);
    const folders = await this.library.discard(imdbId);
    PolicyAnomalies.logger.log(`Anomaly: ${imdbId} taken down by ${actor}, ${folders} store folder(s) deleted`);
    return { status: 'resolved', message: `Titre supprimé (${folders} dossier(s) effacé(s))` };
  }
}
