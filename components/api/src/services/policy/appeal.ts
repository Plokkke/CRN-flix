import { Logger, OnModuleInit } from '@nestjs/common';

import { AppealAnswer, TicketOperation } from '@crn-flix/contracts';

import { displayTitle, MediasRepository } from '@/services/database/medias';
import { PolicyExemptionsRepository, PolicyRefusalsRepository } from '@/services/database/policy';
import { UserEntity, UsersRepository } from '@/services/database/users';
import { LibraryShelves } from '@/services/library/shelves';
import { AllUserMessaging, messagingContextOf } from '@/services/messaging/user/all';
import { PlannerService } from '@/services/planner/planner';
import { OperationOutcome, TicketCategory, TicketEntity, TicketPayloadMap } from '@/services/tickets/model';
import { TicketService } from '@/services/tickets/ticket.service';

export type AppealKind = TicketPayloadMap[TicketCategory.PolicyAppeal]['kind'];

export type AppealSubmission = 'submitted' | 'not-refused' | 'already-pending';

type AppealPayload = TicketPayloadMap[TicketCategory.PolicyAppeal];

const describeError = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/**
 * A subscriber contests a policy refusal or asks for an exemption; the admin answers on the
 * `policy-appeal` ticket. Granting puts the title on the user's personal shelf (downloaded
 * first if the store lacks it); excluding lets the title through the rules for everyone; the
 * user is told every answer at once.
 */
export class PolicyAppealService implements OnModuleInit {
  private static readonly logger = new Logger(PolicyAppealService.name);

  constructor(
    private readonly tickets: TicketService,
    private readonly exemptions: PolicyExemptionsRepository,
    private readonly refusals: PolicyRefusalsRepository,
    private readonly users: UsersRepository,
    private readonly medias: MediasRepository,
    private readonly messaging: AllUserMessaging,
    private readonly planner: PlannerService,
    private readonly shelves: LibraryShelves,
  ) {}

  onModuleInit(): void {
    this.tickets.registerHandler(TicketCategory.PolicyAppeal, (ticket, operation, actor) =>
      this.handle(ticket, operation, actor),
    );
  }

  async submit(user: UserEntity, imdbId: string, kind: AppealKind, motivation: string): Promise<AppealSubmission> {
    const refusal = await this.refusals.getHolding(user.id, imdbId);
    if (!refusal) {
      return 'not-refused';
    }
    if ((await this.exemptions.latestStatusByTitle(user.id)).get(imdbId) === 'pending') {
      return 'already-pending';
    }
    const media = await this.medias.firstOf(imdbId);
    const title = media ? displayTitle(media) : imdbId;
    const payload: AppealPayload = {
      userId: user.id,
      userName: user.name,
      imdbId,
      title,
      kind,
      motivation,
      refusals: refusal.refusals.map(({ ruleId, ruleName, summary }) => ({ ruleId, ruleName, summary })),
    };
    const ticket = await this.tickets.open(
      TicketCategory.PolicyAppeal,
      { type: 'policy_refusal', id: `${user.id}:${imdbId}` },
      payload,
      {
        title: `${kind === 'contest' ? 'Contestation' : 'Dérogation'} — ${title} (${user.name})`,
      },
    );
    const ruleIds = [...new Set(payload.refusals.map((item) => item.ruleId))];
    await this.exemptions.createPending({
      userId: user.id,
      imdbId,
      ruleIds,
      origin: kind,
      motivation,
      ticketId: ticket.id,
    });
    return 'submitted';
  }

  private async handle(ticket: TicketEntity, operation: TicketOperation, actor: string): Promise<OperationOutcome> {
    const payload = ticket.payload as AppealPayload;
    switch (operation.kind) {
      case 'grantExemption':
        await this.exemptions.decidePending(payload.userId, payload.imdbId, 'granted', actor);
        return this.settled(payload, { outcome: 'granted', message: null }, 'Dérogation accordée');
      case 'excludeTitle': {
        const ruleIds = payload.refusals.flatMap((item) => (item.ruleId ? [item.ruleId] : []));
        await this.exemptions.grantGlobal(payload.imdbId, ruleIds, 'contest', actor);
        await this.exemptions.decidePending(payload.userId, payload.imdbId, 'granted', actor);
        return this.settled(payload, { outcome: 'excluded', message: null }, 'Titre exclu de la règle pour tous');
      }
      case 'reject':
        await this.exemptions.decidePending(payload.userId, payload.imdbId, 'denied', actor);
        await this.tell(payload, { outcome: 'denied', message: null });
        return { status: 'resolved', message: 'Demande refusée' };
      case 'reply':
        await this.tell(payload, { outcome: 'message', message: operation.message });
        return { status: 'progress', message: 'Réponse envoyée à l’abonné' };
      default:
        return { status: 'failed', message: `Opération ${operation.kind} non gérée` };
    }
  }

  /** The user gets the title: their refusal lifts, the planner and the shelves catch up now. */
  private async settled(
    payload: AppealPayload,
    answer: Omit<AppealAnswer, 'title'>,
    message: string,
  ): Promise<OperationOutcome> {
    await this.refusals.lift(payload.userId, payload.imdbId);
    const media = await this.medias.firstOf(payload.imdbId);
    if (media) {
      this.planner.schedulePassForMedia(media);
    }
    await this.shelves.reconcile().catch((error: unknown) => {
      PolicyAppealService.logger.warn(`Shelves after appeal on ${payload.imdbId}: ${describeError(error)}`);
    });
    await this.tell(payload, answer);
    return { status: 'resolved', message };
  }

  /** The decision stands whether or not the message leaves: a failure is logged, the ticket says what was decided. */
  private async tell(payload: AppealPayload, answer: Omit<AppealAnswer, 'title'>): Promise<void> {
    const user = await this.users.get(payload.userId);
    if (!user) {
      return;
    }
    await this.messaging
      .appealAnswered(messagingContextOf(user), user.name, { ...answer, title: payload.title })
      .catch((error: unknown) => {
        PolicyAppealService.logger.warn(`Appeal answer to ${user.name} not delivered: ${describeError(error)}`);
      });
  }
}
