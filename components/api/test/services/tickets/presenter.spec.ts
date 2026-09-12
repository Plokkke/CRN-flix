import { PlannedDownloadEntity, PlannedDownloadStatus } from '@/services/database/planned-downloads';
import { PlanLabel } from '@/services/planner/model';
import { TicketCategory, TicketEntity, TicketStatus } from '@/services/tickets/model';
import { buildTicketView } from '@/services/tickets/presenter';

function buildTicket(category: TicketCategory, payload: Record<string, unknown>): TicketEntity {
  return {
    id: 't1',
    category,
    subjectType: null,
    subjectId: null,
    status: TicketStatus.Open,
    title: 'Titre du ticket',
    summary: null,
    payload: payload as TicketEntity['payload'],
    attempts: 0,
    resolution: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    resolvedAt: null,
  };
}

function buildAction(overrides: Partial<PlannedDownloadEntity> = {}): PlannedDownloadEntity {
  return {
    id: 'a1',
    showImdbId: 'tt42',
    scope: { kind: 'season', season: 1 },
    indexerName: 'loadix',
    url: 'https://loadix.test/media/x',
    quality: 'HD_1080P' as PlannedDownloadEntity['quality'],
    language: 'MULTI' as PlannedDownloadEntity['language'],
    host: '1fichier' as PlannedDownloadEntity['host'],
    sizeBytes: 3_000_000_000,
    label: PlanLabel.Needed,
    status: PlannedDownloadStatus.Proposed,
    alternatives: [],
    createdAt: new Date(0),
    updatedAt: new Date(0),
    coveredMediaIds: ['m1'],
    coveredStatuses: ['missing'],
    medias: [],
    userNames: ['antoine'],
    ...overrides,
  };
}

describe('buildTicketView', () => {
  it('renders a download-action with its label tone and reject (not restore)', () => {
    const view = buildTicketView(buildTicket(TicketCategory.DownloadAction, { actionId: 'a1' }), {
      action: buildAction(),
    });

    expect(view.tone).toBe('warning');
    expect(view.operations).toContain('reject');
    expect(view.operations).not.toContain('restore');
    expect(view.fields.map((f) => f.name)).toEqual(expect.arrayContaining(['Priorité', 'Qualité', 'Lien']));
  });

  it('offers restore instead of reject on a fully-rejected action', () => {
    const view = buildTicketView(buildTicket(TicketCategory.DownloadAction, { actionId: 'a1' }), {
      action: buildAction({ status: PlannedDownloadStatus.Expired, coveredStatuses: ['rejected', 'rejected'] }),
    });

    expect(view.tone).toBe('danger');
    expect(view.operations).toContain('restore');
    expect(view.operations).not.toContain('reject');
  });

  it('renders a pipeline failure as a dead-letter with only manual resolution', () => {
    const view = buildTicketView(
      buildTicket(TicketCategory.PipelineFailure, {
        jobId: 'j1',
        fileNames: 'x.mkv',
        failedStep: 'placement',
        errorMessage: 'ENOSPC',
      }),
    );

    expect(view.tone).toBe('danger');
    expect(view.operations).toEqual(['resolveManually']);
  });

  it('renders a missing-imdb ticket with the imdb footer hint', () => {
    const view = buildTicketView(
      buildTicket(TicketCategory.MissingImdb, { title: 'Silo', year: 2023, kind: 'show', mediaIds: ['m1', 'm2'] }),
    );

    expect(view.footer).toContain('tt1234567');
    expect(view.operations).toEqual(['submitImdb', 'resolveManually']);
    expect(view.fields).toContainEqual({ name: 'Médias en attente', value: '2' });
  });

  it('renders a closed ticket with no operations and its resolution', () => {
    const ticket = {
      ...buildTicket(TicketCategory.ManualDownload, { url: 'https://x' }),
      status: TicketStatus.Resolved,
      resolution: 'Téléchargement abouti',
    };

    const view = buildTicketView(ticket);

    expect(view.tone).toBe('success');
    expect(view.operations).toEqual([]);
    expect(view.fields).toContainEqual({ name: 'Résolution', value: 'Téléchargement abouti' });
  });

  it('marks a manual download with a lastError as urgent', () => {
    const view = buildTicketView(
      buildTicket(TicketCategory.ManualDownload, { url: 'https://x', lastError: 'Identification failed' }),
    );

    expect(view.tone).toBe('danger');
    expect(view.fields.map((f) => f.name)).toContain('Erreur');
  });
});
