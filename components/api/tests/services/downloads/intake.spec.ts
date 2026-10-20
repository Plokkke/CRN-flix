import { CompletedDownload, Downloader } from '@crn-flix/contracts';

import { DownloadJobsRepository } from '@/services/database/download-jobs';
import { DownloadIntakeService } from '@/services/downloads/intake';

const completed: CompletedDownload = {
  id: 'dl-1',
  fileName: 'Silo.S01E01.mkv',
  filePaths: ['/data/downloads/Silo/Silo.S01E01.mkv'],
  size: 1000,
  source: 'https://1fichier.com/?abc',
  metadata: { imdbid: 'tt14688458' },
  downloadedAt: '2026-10-20T08:00:00Z',
  completedAt: '2026-10-20T08:10:00Z',
};

function build() {
  let listener: ((download: CompletedDownload) => Promise<void> | void) | null = null;
  const downloader = {
    name: 'test',
    start: jest.fn(),
    stop: jest.fn(),
    onCompleted: jest.fn((l) => {
      listener = l;
      return () => (listener = null);
    }),
  };
  const downloadJobs = {
    getBySourceId: jest.fn().mockResolvedValue(null),
    create: jest.fn().mockResolvedValue({ id: 'job-1' }),
  };
  const service = new DownloadIntakeService(
    downloader as unknown as Downloader,
    downloadJobs as unknown as DownloadJobsRepository,
  );
  return { service, downloader, downloadJobs, emit: (d: CompletedDownload) => listener?.(d) };
}

describe('DownloadIntakeService', () => {
  it('starts the downloader and records every completion as a download job', async () => {
    const { service, downloader, downloadJobs, emit } = build();

    service.onModuleInit();
    await emit(completed);

    expect(downloader.start).toHaveBeenCalled();
    expect(downloadJobs.create).toHaveBeenCalledWith({
      sourceId: 'dl-1',
      packageName: 'Silo.S01E01.mkv',
      saveTo: '/data/downloads/Silo',
      sourcePaths: ['/data/downloads/Silo/Silo.S01E01.mkv'],
      metadata: { imdbid: 'tt14688458' },
    });
  });

  it('skips a replayed completion it already recorded', async () => {
    const { service, downloadJobs } = build();
    downloadJobs.getBySourceId.mockResolvedValue({ id: 'job-1' });

    await service.record(completed);

    expect(downloadJobs.create).not.toHaveBeenCalled();
  });

  it('stops listening and stops the downloader on shutdown', async () => {
    const { service, downloader, downloadJobs, emit } = build();
    service.onModuleInit();

    service.onModuleDestroy();
    await emit(completed);

    expect(downloader.stop).toHaveBeenCalled();
    expect(downloadJobs.create).not.toHaveBeenCalled();
  });
});
