import { DownloadJobEvents, DownloadJobsRepository, DownloadJobStatus } from '@/services/database/download-jobs';
import { ManualNumberingRepository } from '@/services/database/manual-numbering';
import { MediasRepository } from '@/services/database/medias';
import { ParkedDownloads } from '@/services/downloads/parked';
import { MediaLabelizerService } from '@/services/media-labelizer';
import { TicketCategory } from '@/services/tickets/model';
import { TicketService } from '@/services/tickets/ticket.service';

type Handlers = { [K in keyof DownloadJobEvents]?: (payload: DownloadJobEvents[K]) => Promise<void> };

function build() {
  let handlers: Handlers = {};
  const job = {
    id: 'j1',
    status: DownloadJobStatus.AwaitingMapping,
    mappingImdbId: 'tt3121722',
    sourcePaths: ['/data/downloads/PAW/PAW.S08E02.mkv'],
  };
  const jobs = {
    listen: (listeners: Handlers) => {
      handlers = listeners;
      return { cleanup: () => {} };
    },
    get: jest.fn().mockResolvedValue(job),
  };
  const tickets = {
    open: jest.fn().mockResolvedValue(undefined),
    resolveBySubject: jest.fn().mockResolvedValue(undefined),
  };
  const parked = new ParkedDownloads(
    jobs as unknown as DownloadJobsRepository,
    {} as ManualNumberingRepository,
    { displayTitlesOf: async () => new Map([['tt3121722', 'La Pat’ Patrouille']]) } as unknown as MediasRepository,
    {} as MediaLabelizerService,
    tickets as unknown as TicketService,
    'https://crn-flix.example',
  );
  parked.onModuleInit();
  return { handlers: () => handlers, tickets };
}

describe('ParkedDownloads', () => {
  it('asks the admin to classify a parked download on the show’s episodes page', async () => {
    const { handlers, tickets } = build();

    await handlers().statusChange?.({ jobId: 'j1', oldStatus: 'identifying', newStatus: 'awaiting-mapping' });

    expect(tickets.open).toHaveBeenCalledWith(
      TicketCategory.EpisodeMapping,
      { type: 'download_job', id: 'j1' },
      {
        jobId: 'j1',
        imdbId: 'tt3121722',
        title: 'La Pat’ Patrouille',
        fileNames: ['PAW.S08E02.mkv'],
        pageUrl: 'https://crn-flix.example/admin/library/tt3121722/episodes',
      },
      { title: 'Épisodes à classer — La Pat’ Patrouille' },
    );
  });

  it('closes the ticket once the job completes', async () => {
    const { handlers, tickets } = build();

    await handlers().statusChange?.({ jobId: 'j1', oldStatus: 'awaiting-mapping', newStatus: 'completed' });

    expect(tickets.resolveBySubject).toHaveBeenCalledWith(
      TicketCategory.EpisodeMapping,
      'download_job',
      'j1',
      'Fichiers classés',
    );
  });
});
