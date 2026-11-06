import { MediasRepository, MediaType } from '@/services/database/medias';
import { PolicyExemptionsRepository, PolicyRefusalsRepository } from '@/services/database/policy';
import { UserEntity, UsersRepository } from '@/services/database/users';
import { LibraryShelves } from '@/services/library/shelves';
import { AllUserMessaging } from '@/services/messaging/user/all';
import { PlannerService } from '@/services/planner/planner';
import { PolicyAppealService } from '@/services/policy/appeal';
import { TicketCategory, TicketEntity, TicketPayloadMap } from '@/services/tickets/model';
import { parseMessageOperation } from '@/services/tickets/parse';
import { buildTicketView } from '@/services/tickets/presenter';
import { TicketService } from '@/services/tickets/ticket.service';

const USER = { id: 'son', name: 'Léo', messagingKey: 'email', messagingId: 'leo@x' } as UserEntity;
const MEDIA = { id: 'm1', imdbId: 'tt1', type: MediaType.Movie, title: 'War', frenchTitle: 'Guerre' };
const REFUSAL = {
  userId: 'son',
  imdbId: 'tt1',
  refusals: [{ ruleId: 'kids-rule', ruleName: 'Enfants', summary: 'Classification : FR:12', notices: [] }],
  refusedAt: new Date(),
  notifiedAt: new Date(),
};

function build(opts: { refusal?: typeof REFUSAL | null; latest?: Map<string, string> } = {}) {
  let handler: (ticket: TicketEntity, operation: never, actor: string) => Promise<unknown> = async () => null;
  const tickets = {
    registerHandler: jest.fn((_category, registered) => (handler = registered)),
    open: jest.fn().mockResolvedValue({ id: 'ticket-1' }),
  };
  const exemptions = {
    latestStatusByTitle: jest.fn().mockResolvedValue(opts.latest ?? new Map()),
    createPending: jest.fn().mockResolvedValue(undefined),
    decidePending: jest.fn().mockResolvedValue(1),
    grantGlobal: jest.fn().mockResolvedValue(undefined),
  };
  const refusals = {
    getHolding: jest.fn().mockResolvedValue(opts.refusal === undefined ? REFUSAL : opts.refusal),
    lift: jest.fn().mockResolvedValue(undefined),
  };
  const messaging = { appealAnswered: jest.fn().mockResolvedValue(undefined) };
  const planner = { schedulePassForMedia: jest.fn() };
  const shelves = { reconcile: jest.fn().mockResolvedValue(undefined) };
  const service = new PolicyAppealService(
    tickets as unknown as TicketService,
    exemptions as unknown as PolicyExemptionsRepository,
    refusals as unknown as PolicyRefusalsRepository,
    { get: jest.fn().mockResolvedValue(USER) } as unknown as UsersRepository,
    { firstOf: jest.fn().mockResolvedValue(MEDIA) } as unknown as MediasRepository,
    messaging as unknown as AllUserMessaging,
    planner as unknown as PlannerService,
    shelves as unknown as LibraryShelves,
  );
  service.onModuleInit();
  const payload: TicketPayloadMap[TicketCategory.PolicyAppeal] = {
    userId: 'son',
    userName: 'Léo',
    imdbId: 'tt1',
    title: 'Guerre',
    kind: 'exemption',
    motivation: 'Exposé d’histoire sur la Seconde Guerre mondiale.',
    refusals: [{ ruleId: 'kids-rule', ruleName: 'Enfants', summary: 'Classification : FR:12' }],
  };
  const ticket = { category: TicketCategory.PolicyAppeal, payload } as TicketEntity;
  const operate = (operation: unknown) => handler(ticket, operation as never, 'discord:admin');
  return { service, tickets, exemptions, refusals, messaging, planner, shelves, operate, ticket };
}

describe('PolicyAppealService.submit', () => {
  it('opens one ticket per refused title with the refusals, and one pending exemption per refusing rule', async () => {
    const { service, tickets, exemptions } = build();

    await expect(service.submit(USER, 'tt1', 'exemption', 'Exposé d’histoire, avec mes parents.')).resolves.toBe(
      'submitted',
    );

    expect(tickets.open).toHaveBeenCalledWith(
      TicketCategory.PolicyAppeal,
      { type: 'policy_refusal', id: 'son:tt1' },
      expect.objectContaining({
        title: 'Guerre',
        kind: 'exemption',
        refusals: [expect.objectContaining({ ruleName: 'Enfants' })],
      }),
      { title: 'Dérogation — Guerre (Léo)' },
    );
    expect(exemptions.createPending).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'son',
        imdbId: 'tt1',
        ruleIds: ['kids-rule'],
        origin: 'exemption',
        ticketId: 'ticket-1',
      }),
    );
  });

  it('refuses an appeal on a title not refused, or already under review', async () => {
    await expect(build({ refusal: null }).service.submit(USER, 'tt1', 'contest', 'x'.repeat(30))).resolves.toBe(
      'not-refused',
    );
    await expect(
      build({ latest: new Map([['tt1', 'pending']]) }).service.submit(USER, 'tt1', 'contest', 'x'.repeat(30)),
    ).resolves.toBe('already-pending');
  });
});

describe('PolicyAppealService answers', () => {
  it('grants: personal exemption, refusal lifted, planner and shelves now, user told', async () => {
    const { operate, exemptions, refusals, planner, shelves, messaging } = build();

    await expect(operate({ kind: 'grantExemption' })).resolves.toEqual({
      status: 'resolved',
      message: 'Dérogation accordée',
    });

    expect(exemptions.decidePending).toHaveBeenCalledWith('son', 'tt1', 'granted', 'discord:admin');
    expect(exemptions.grantGlobal).not.toHaveBeenCalled();
    expect(refusals.lift).toHaveBeenCalledWith('son', 'tt1');
    expect(planner.schedulePassForMedia).toHaveBeenCalledWith(MEDIA);
    expect(shelves.reconcile).toHaveBeenCalled();
    expect(messaging.appealAnswered).toHaveBeenCalledWith(expect.anything(), 'Léo', {
      title: 'Guerre',
      outcome: 'granted',
      message: null,
    });
  });

  it('excludes: the refusing rules no longer apply to the title, for everyone', async () => {
    const { operate, exemptions } = build();

    await operate({ kind: 'excludeTitle' });

    expect(exemptions.grantGlobal).toHaveBeenCalledWith('tt1', ['kids-rule'], 'contest', 'discord:admin');
  });

  it('rejects: the exemption is denied and the user told, nothing else moves', async () => {
    const { operate, exemptions, refusals, messaging } = build();

    await expect(operate({ kind: 'reject' })).resolves.toMatchObject({ status: 'resolved' });

    expect(exemptions.decidePending).toHaveBeenCalledWith('son', 'tt1', 'denied', 'discord:admin');
    expect(refusals.lift).not.toHaveBeenCalled();
    expect(messaging.appealAnswered).toHaveBeenCalledWith(
      expect.anything(),
      'Léo',
      expect.objectContaining({ outcome: 'denied' }),
    );
  });

  it('replies: the message reaches the user, the ticket stays open', async () => {
    const { operate, messaging } = build();

    await expect(operate({ kind: 'reply', message: 'Quel est le sujet de l’exposé ?' })).resolves.toMatchObject({
      status: 'progress',
    });
    expect(messaging.appealAnswered).toHaveBeenCalledWith(expect.anything(), 'Léo', {
      title: 'Guerre',
      outcome: 'message',
      message: 'Quel est le sujet de l’exposé ?',
    });
  });

  it('keeps the decision when the message cannot leave', async () => {
    const { operate, messaging } = build();
    messaging.appealAnswered.mockRejectedValue(new Error('SMTP down'));

    await expect(operate({ kind: 'grantExemption' })).resolves.toMatchObject({ status: 'resolved' });
  });
});

describe('policy-appeal ticket surfaces', () => {
  it('shows the request, the motivation and the refusals, with the four answers', () => {
    const { ticket } = build();
    const view = buildTicketView({ ...ticket, status: 'open', title: 'Dérogation — Guerre (Léo)' } as TicketEntity);

    expect(view.fields.map((field) => field.name)).toEqual([
      'Abonné',
      'Titre',
      'Démarche',
      'Motivation',
      'Refus : Enfants',
    ]);
    expect(view.operations).toEqual(['grantExemption', 'excludeTitle', 'reject', 'reply']);
  });

  it('turns a thread message into a reply to the user', () => {
    expect(parseMessageOperation('Quel sujet ?', ['grantExemption', 'reply'], () => null)).toEqual({
      kind: 'reply',
      message: 'Quel sujet ?',
    });
  });
});
