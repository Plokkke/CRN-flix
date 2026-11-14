import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

import { Player } from '@crn-flix/contracts';
import { Placement } from '@crn-flix/policy';

import { LibraryTitle, LibraryTitlesRepository, ShelfOverridesRepository } from '@/services/database/library';
import { MediasRepository } from '@/services/database/medias';
import { PolicyExemptionsRepository } from '@/services/database/policy';
import { TicketsRepository } from '@/services/database/tickets';
import { LibraryPaths } from '@/services/library/paths';
import { LibraryShelves, ShelfResolver } from '@/services/library/shelves';
import { PolicyAnomalies } from '@/services/policy/anomaly';
import { PolicyService } from '@/services/policy/policy';
import { TicketCategory, TicketEntity } from '@/services/tickets/model';
import { TicketService } from '@/services/tickets/ticket.service';

const RESTRICTED: Extract<Placement, { kind: 'restricted' }> = {
  kind: 'restricted',
  refusals: [{ ruleId: 'credits', ruleName: 'Violences', summary: 'Jo (Réalisation)', notices: [] }],
};

function build(
  opts: { placement?: Placement; override?: string | null; openTicket?: boolean; stored?: string[] } = {},
) {
  const overrides = new Map<string, { shelf: string; origin: string }>(
    opts.override ? [['tt1', { shelf: opts.override, origin: 'anomaly' }]] : [],
  );
  const overridesRepo = {
    get: jest.fn(async (imdbId: string) => overrides.get(imdbId)?.shelf ?? null),
    set: jest.fn(async (o: { imdbId: string; shelf: string; origin: string }) => overrides.set(o.imdbId, o)),
    clear: jest.fn(async (imdbId: string) => overrides.delete(imdbId)),
    listByOrigin: jest.fn(async (origin: string) =>
      [...overrides.entries()].filter(([, o]) => o.origin === origin).map(([imdbId, o]) => ({ imdbId, ...o })),
    ),
    list: jest.fn(async () => new Map([...overrides.entries()].map(([imdbId, o]) => [imdbId, o.shelf]))),
  };
  let handler: (t: TicketEntity, op: never, actor: string) => Promise<unknown> = async () => null;
  const tickets = {
    registerHandler: jest.fn((_c, h) => (handler = h)),
    open: jest.fn().mockResolvedValue({ id: 'ticket-1' }),
    resolveById: jest.fn().mockResolvedValue(undefined),
  };
  const policy = { placementOf: jest.fn().mockResolvedValue(opts.placement ?? RESTRICTED) };
  const exemptions = { grantGlobal: jest.fn().mockResolvedValue(undefined) };
  const anomalies = new PolicyAnomalies(
    policy as unknown as PolicyService,
    tickets as unknown as TicketService,
    {
      getOpenBySubject: jest.fn().mockResolvedValue(opts.openTicket ? { id: 'ticket-1' } : null),
    } as unknown as TicketsRepository,
    overridesRepo as unknown as ShelfOverridesRepository,
    exemptions as unknown as PolicyExemptionsRepository,
    { firstOf: jest.fn().mockResolvedValue({ title: 'Film', frenchTitle: null }) } as unknown as MediasRepository,
    {
      list: jest.fn().mockResolvedValue((opts.stored ?? ['tt1']).map((imdbId) => ({ imdbId }))),
    } as unknown as LibraryTitlesRepository,
  );
  anomalies.onModuleInit();
  const operate = (kind: string) =>
    handler(
      {
        category: TicketCategory.PolicyAnomaly,
        payload: { imdbId: 'tt1', title: 'Film', shelf: 'standard', refusals: RESTRICTED.refusals },
      } as unknown as TicketEntity,
      { kind } as never,
      'discord:admin',
    );
  return { anomalies, overrides, overridesRepo, tickets, policy, exemptions, operate };
}

describe('PolicyAnomalies', () => {
  it('keeps a title the rules now restrict on its shelf, with a ticket naming the rules', async () => {
    const { anomalies, overrides, tickets } = build();

    await expect(anomalies.freeze([{ imdbId: 'tt1', shelf: 'standard' }])).resolves.toEqual(new Set(['tt1']));

    expect(overrides.get('tt1')).toEqual({ imdbId: 'tt1', shelf: 'standard', origin: 'anomaly' });
    expect(tickets.open).toHaveBeenCalledWith(
      TicketCategory.PolicyAnomaly,
      { type: 'media', id: 'tt1' },
      expect.objectContaining({ shelf: 'standard', refusals: [expect.objectContaining({ ruleName: 'Violences' })] }),
      { title: 'Anomalie — Film enfreint désormais une règle' },
    );
  });

  it('lets a title move between shared shelves, and leaves the admin’s choices alone', async () => {
    const moving = build({ placement: { kind: 'shelf', shelf: 'kids', forced: false } });
    await expect(moving.anomalies.freeze([{ imdbId: 'tt1', shelf: 'standard' }])).resolves.toEqual(new Set());

    const chosen = build({ override: 'none' });
    await expect(chosen.anomalies.freeze([{ imdbId: 'tt1', shelf: 'standard' }])).resolves.toEqual(new Set());
  });

  it('resolves itself once the title breaks no rule, or its files are gone', async () => {
    const fine = build({
      override: 'standard',
      openTicket: true,
      placement: { kind: 'shelf', shelf: 'standard', forced: false },
    });
    await fine.anomalies.sweep();
    expect(fine.tickets.resolveById).toHaveBeenCalledWith('ticket-1', 'Le titre ne viole plus aucune règle');
    expect(fine.overrides.size).toBe(0);

    const gone = build({ override: 'standard', openTicket: true, stored: [] });
    await gone.anomalies.sweep();
    expect(gone.tickets.resolveById).toHaveBeenCalledWith('ticket-1', 'Fichiers retirés du stock');

    const pending = build({ override: 'standard', openTicket: true });
    await pending.anomalies.sweep();
    expect(pending.overrides.size).toBe(1);
  });

  it('excludes the title from the refusing rules, or takes it down by deleting its files', async () => {
    const exclude = build({ override: 'standard', openTicket: true });
    const reconcile = jest.fn().mockResolvedValue(undefined);
    exclude.anomalies.wire({ reconcile, discard: jest.fn() });

    await expect(exclude.operate('excludeTitle')).resolves.toMatchObject({ status: 'resolved' });
    expect(exclude.exemptions.grantGlobal).toHaveBeenCalledWith('tt1', ['credits'], 'admin', 'discord:admin');
    expect(exclude.overrides.size).toBe(0);
    expect(reconcile).toHaveBeenCalled();

    const unpublish = build({ override: 'standard', openTicket: true });
    const discard = jest.fn().mockResolvedValue(1);
    unpublish.anomalies.wire({ reconcile, discard });
    await expect(unpublish.operate('unpublish')).resolves.toMatchObject({
      status: 'resolved',
      message: 'Titre supprimé (1 dossier(s) effacé(s))',
    });
    expect(unpublish.exemptions.grantGlobal).not.toHaveBeenCalled();
    expect(discard).toHaveBeenCalledWith('tt1');
    expect(unpublish.overrides.size).toBe(0);
  });

  it('remembers a title taken down: not frozen again, released once it breaks no rule', async () => {
    const takenDown = build({ override: 'none' });
    await takenDown.anomalies.sweep();
    expect(takenDown.overrides.get('tt1')).toMatchObject({ shelf: 'none' });
    await expect(takenDown.anomalies.freeze([{ imdbId: 'tt1', shelf: 'standard' }])).resolves.toEqual(new Set());
    expect(takenDown.tickets.open).not.toHaveBeenCalled();

    const fineAgain = build({ override: 'none', placement: { kind: 'shelf', shelf: 'standard', forced: false } });
    await fineAgain.anomalies.sweep();
    expect(fineAgain.overrides.size).toBe(0);
  });
});

describe('LibraryShelves with the anomaly guard', () => {
  let root: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'crn-flix-anomaly-'));
  });

  afterEach(() => fs.rm(root, { recursive: true, force: true }));

  it('does not take down a title the rules now restrict: it stays linked while the ticket is open', async () => {
    const paths = new LibraryPaths({
      mediasPath: root,
      moviesFolder: 'movies',
      seriesFolder: 'series',
      playerRoot: '/medias',
      kidsMaxParentalRating: 10,
      adminUserName: null,
    });
    const title: LibraryTitle = { section: 'movies', folder: 'Film [imdbid-tt1]', imdbId: 'tt1' };
    await fs.mkdir(path.join(root, 'store', 'movies', title.folder), { recursive: true });
    const { anomalies, overridesRepo } = build({ openTicket: true });
    let restricted = false;
    const resolver: ShelfResolver = {
      sharedShelves: ['kids', 'standard'],
      shelvesOf: async () => {
        const override = await overridesRepo.get('tt1');
        return () => ({ shared: override ?? (restricted ? null : 'standard'), personal: [] });
      },
    };
    const library = new LibraryShelves(
      paths,
      { list: async () => [title], record: async () => undefined } as unknown as LibraryTitlesRepository,
      resolver,
      { refreshLibrary: jest.fn().mockResolvedValue(undefined) } as unknown as Player,
      async () => {},
      anomalies,
    );

    await library.reconcile();
    restricted = true;
    await library.reconcile();

    await fs.access(path.join(root, 'movies', title.folder));
  });
});
