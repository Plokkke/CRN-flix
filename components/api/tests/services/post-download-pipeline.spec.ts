import { DownloadJobEntity, DownloadJobsRepository, DownloadJobStatus } from '@/services/database/download-jobs';
import { TicketsRepository } from '@/services/database/tickets';
import { MediaIdentifierService } from '@/services/media-identifier';
import { MediaLabelizerService } from '@/services/media-labelizer';
import { PostDownloadPipeline } from '@/services/post-download-pipeline';
import { TICKET_ID_METADATA_KEY, TicketCategory } from '@/services/tickets/model';

function buildJob(metadata: Record<string, string>): DownloadJobEntity {
  return {
    id: 'j1',
    sourceId: 'd1',
    packageName: 'Movie.2020.1080p',
    saveTo: '/downloads/Movie.2020.1080p',
    status: DownloadJobStatus.Detected,
    sourcePaths: ['/downloads/Movie.2020.1080p/Movie.2020.1080p.mkv'],
    errorMessage: null,
    metadata,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  };
}

function buildStubs(job: DownloadJobEntity, ticket: { category: TicketCategory; payload: unknown } | null) {
  return {
    downloadJobs: { get: jest.fn().mockResolvedValue(job), updateStatus: jest.fn().mockResolvedValue(undefined) },
    identification: {
      identifyFromRequest: jest.fn().mockResolvedValue({ imdbId: 'tt1', title: 'Movie', mediaType: 'movie' }),
      identifyWithImdbId: jest.fn(),
      identify: jest.fn(),
    },
    placement: { move: jest.fn().mockResolvedValue(undefined) },
    tickets: { get: jest.fn().mockResolvedValue(ticket) },
  };
}

function buildPipeline(stubs: ReturnType<typeof buildStubs>): PostDownloadPipeline {
  return new PostDownloadPipeline(
    stubs.downloadJobs as unknown as DownloadJobsRepository,
    stubs.identification as unknown as MediaIdentifierService,
    stubs.placement as unknown as MediaLabelizerService,
    stubs.tickets as unknown as TicketsRepository,
  );
}

describe('PostDownloadPipeline identity resolution', () => {
  const metadata = { 'crn-flix-request-id': 'm1', imdbid: 'tt1234567', [TICKET_ID_METADATA_KEY]: 't1' };

  it('files the download under the request corrected on the manual-download ticket', async () => {
    const stubs = buildStubs(buildJob(metadata), {
      category: TicketCategory.ManualDownload,
      payload: { url: 'https://x', imdbId: 'tt7654321', requestId: 'm2' },
    });

    await buildPipeline(stubs).processJob('j1');

    expect(stubs.identification.identifyFromRequest).toHaveBeenCalledWith(expect.any(String), 'm2', 'j1');
    expect(stubs.downloadJobs.updateStatus).toHaveBeenLastCalledWith('j1', DownloadJobStatus.Completed);
  });

  it('falls back to the launch metadata when the ticket carries no request', async () => {
    const stubs = buildStubs(buildJob(metadata), {
      category: TicketCategory.ManualDownload,
      payload: { url: 'https://x' },
    });

    await buildPipeline(stubs).processJob('j1');

    expect(stubs.identification.identifyFromRequest).toHaveBeenCalledWith(expect.any(String), 'm1', 'j1');
  });

  it('ignores tickets of other categories and downloads without a ticket', async () => {
    const stubs = buildStubs(buildJob({ 'crn-flix-request-id': 'm1' }), null);

    await buildPipeline(stubs).processJob('j1');

    expect(stubs.tickets.get).not.toHaveBeenCalled();
    expect(stubs.identification.identifyFromRequest).toHaveBeenCalledWith(expect.any(String), 'm1', 'j1');
  });
});
