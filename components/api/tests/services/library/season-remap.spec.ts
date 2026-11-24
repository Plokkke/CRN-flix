import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

import { Catalog, MetadataSource, Player } from '@crn-flix/contracts';
import { JellyfinLayout } from '@crn-flix/layout-jellyfin';

import { DownloadJobsRepository, DownloadJobStatus } from '@/services/database/download-jobs';
import { LibraryTitlesRepository } from '@/services/database/library';
import { ManualNumberingRepository } from '@/services/database/manual-numbering';
import { MediasRepository } from '@/services/database/medias';
import { ParkedDownloads } from '@/services/downloads/parked';
import { LibraryPaths } from '@/services/library/paths';
import { RemapRefusedError, SeasonRemapService } from '@/services/library/season-remap';
import { MediaLabelizerService } from '@/services/media-labelizer';
import { TicketService } from '@/services/tickets/ticket.service';

const IMDB = 'tt7678620';
const FOLDER = 'Bluey.(2018).[imdbid-tt7678620]';
const name = (tag: string, ext = 'mkv'): string => `Bluey.(2018).${tag}.[imdbid-${IMDB}].${ext}`;

describe('SeasonRemapService', () => {
  let media: string;
  let season: string;
  let refreshLibrary: jest.Mock;
  let service: SeasonRemapService;
  let jobs: {
    listAwaitingMapping: jest.Mock;
    get: jest.Mock;
    updateStatus: jest.Mock;
    updateSourcePaths: jest.Mock;
  };

  const listSeason = async (): Promise<string[]> => (await fs.readdir(season)).sort();

  beforeEach(async () => {
    media = await fs.mkdtemp(path.join(os.tmpdir(), 'crn-flix-remap-'));
    season = path.join(media, 'store', 'series', FOLDER, 'Season01');
    await fs.mkdir(season, { recursive: true });
    await Promise.all(
      [name('S01E01-E02'), name('S01E03-E04'), name('S01E01-E02', 'fr.srt')].map((file) =>
        fs.writeFile(path.join(season, file), file),
      ),
    );
    refreshLibrary = jest.fn().mockResolvedValue(undefined);
    jobs = {
      listAwaitingMapping: jest.fn().mockResolvedValue([]),
      get: jest.fn(),
      updateStatus: jest.fn().mockResolvedValue(undefined),
      updateSourcePaths: jest.fn().mockResolvedValue(undefined),
    };
    service = new SeasonRemapService(
      new LibraryPaths({
        mediasPath: media,
        moviesFolder: 'movies',
        seriesFolder: 'series',
        playerRoot: '/media',
        kidsMaxParentalRating: 10,
      }),
      { list: async () => [{ section: 'series', folder: FOLDER, imdbId: IMDB }] } as unknown as LibraryTitlesRepository,
      {
        episodes: async () => [
          { season: 1, number: 1, title: 'Magic Xylophone', frenchTitle: null, overview: null, runtimeMinutes: 7 },
          { season: 2, number: 1, title: 'Dance Mode', frenchTitle: null, overview: null, runtimeMinutes: 7 },
        ],
      } as unknown as Catalog,
      { describe: async () => ({ title: 'Bluey', year: 2018 }) } as unknown as MetadataSource,
      { displayTitlesOf: async () => new Map([[IMDB, 'Bluey']]) } as unknown as MediasRepository,
      new JellyfinLayout(),
      { refreshLibrary } as unknown as Player,
      new ParkedDownloads(
        jobs as unknown as DownloadJobsRepository,
        {} as ManualNumberingRepository,
        {} as MediasRepository,
        new MediaLabelizerService(
          {
            downloads: path.join(media, 'downloads'),
            movies: path.join(media, 'store', 'movies'),
            series: path.join(media, 'store', 'series'),
          },
          { describe: async () => ({ title: 'Bluey', year: 2018 }) } as unknown as MetadataSource,
          new JellyfinLayout(),
        ),
        {} as TicketService,
        'https://crn-flix.example',
      ),
      { isManual: async () => true } as unknown as ManualNumberingRepository,
      media,
    );
  });

  afterEach(() => fs.rm(media, { recursive: true, force: true }));

  const relative = (file: string): string => path.join(FOLDER, 'Season01', file);

  it('shows the season files next to the catalog episodes', async () => {
    const page = await service.page(IMDB, null);

    expect(page).toMatchObject({ title: 'Bluey', season: 1, seasons: [1, 2] });
    expect(page?.files[0].diskPath).toBe(path.join('store', 'series', FOLDER, 'Season01', name('S01E01-E02')));
    expect(page?.files.map((file) => file.tag)).toEqual([
      { season: 1, start: 1, end: 2 },
      { season: 1, start: 3, end: 4 },
    ]);
    expect(page?.episodes).toHaveLength(2);
  });

  it('swaps two files with their subtitles, then asks the player to rescan', async () => {
    const moved = await service.apply(IMDB, [
      { relativePath: relative(name('S01E01-E02')), season: 1, start: 3, end: 4 },
      { relativePath: relative(name('S01E03-E04')), season: 1, start: 1, end: 2 },
    ]);

    expect(moved).toBe(2);
    expect(await listSeason()).toEqual([name('S01E01-E02'), name('S01E03-E04'), name('S01E03-E04', 'fr.srt')].sort());
    expect(await fs.readFile(path.join(season, name('S01E01-E02')), 'utf8')).toBe(name('S01E03-E04'));
    expect(await fs.readFile(path.join(season, name('S01E03-E04', 'fr.srt')), 'utf8')).toBe(
      name('S01E01-E02', 'fr.srt'),
    );
    expect(refreshLibrary).toHaveBeenCalledTimes(1);
  });

  it('leaves unchanged files alone and does not rescan for nothing', async () => {
    await expect(
      service.apply(IMDB, [{ relativePath: relative(name('S01E01-E02')), season: 1, start: 1, end: 2 }]),
    ).resolves.toBe(0);
    expect(refreshLibrary).not.toHaveBeenCalled();
  });

  it('refuses a mapping where two files hold the same episode, moving nothing', async () => {
    await expect(
      service.apply(IMDB, [{ relativePath: relative(name('S01E01-E02')), season: 1, start: 4, end: 5 }]),
    ).rejects.toThrow(RemapRefusedError);
    expect(await listSeason()).toEqual([name('S01E01-E02'), name('S01E01-E02', 'fr.srt'), name('S01E03-E04')].sort());
  });

  it('moves a file out of a historical season folder and removes the emptied folder', async () => {
    const old = path.join(media, 'store', 'series', FOLDER, 'Season 1');
    await fs.mkdir(old);
    await fs.writeFile(path.join(old, 'Bluey - 05.mkv'), 'x');

    await service.apply(IMDB, [
      { relativePath: path.join(FOLDER, 'Season 1', 'Bluey - 05.mkv'), season: 1, start: 5, end: 6 },
    ]);

    expect(await listSeason()).toContain(name('S01E05-E06'));
    await expect(fs.access(old)).rejects.toThrow();
  });

  it('moves a file to another season, in its own season folder', async () => {
    await service.apply(IMDB, [{ relativePath: relative(name('S01E03-E04')), season: 2, start: 5, end: 6 }]);

    await expect(fs.readdir(path.join(media, 'store', 'series', FOLDER, 'Season02'))).resolves.toEqual([
      name('S02E05-E06'),
    ]);
    expect((await service.page(IMDB, 2))?.files.map((file) => file.tag?.season)).toEqual([2]);
  });

  it('places a waiting download where the admin says, then completes its job', async () => {
    const download = path.join(media, 'downloads', 'PAW', 'Bluey.S08E02.FRENCH.mkv');
    await fs.mkdir(path.dirname(download), { recursive: true });
    await fs.writeFile(download, 'x');
    const job = { id: 'j1', packageName: 'PAW', status: DownloadJobStatus.AwaitingMapping, sourcePaths: [download] };
    jobs.listAwaitingMapping.mockResolvedValue([job]);
    jobs.get.mockResolvedValue(job);

    const page = await service.page(IMDB, 1);
    expect(page?.manual).toBe(true);
    expect(page?.files[0]).toMatchObject({
      relativePath: 'pending:j1/Bluey.S08E02.FRENCH.mkv',
      tag: null,
      pendingFrom: 'PAW',
    });
    expect(page?.files[0].diskPath).toBe(path.join('downloads', 'PAW', 'Bluey.S08E02.FRENCH.mkv'));

    await service.apply(IMDB, [{ relativePath: 'pending:j1/Bluey.S08E02.FRENCH.mkv', season: 1, start: 5, end: 6 }]);

    expect(await listSeason()).toContain(name('S01E05-E06'));
    await expect(fs.access(download)).rejects.toThrow();
    expect(jobs.updateStatus).toHaveBeenCalledWith('j1', DownloadJobStatus.Completed);
  });

  it('refuses to give a waiting file an episode another file holds', async () => {
    const download = path.join(media, 'downloads', 'PAW', 'other.mkv');
    await fs.mkdir(path.dirname(download), { recursive: true });
    await fs.writeFile(download, 'x');
    jobs.listAwaitingMapping.mockResolvedValue([
      { id: 'j1', packageName: 'PAW', status: DownloadJobStatus.AwaitingMapping, sourcePaths: [download] },
    ]);

    await expect(
      service.apply(IMDB, [{ relativePath: 'pending:j1/other.mkv', season: 1, start: 2, end: 2 }]),
    ).rejects.toThrow('S01E02 revendiqué par 2 fichiers');
    await expect(fs.access(download)).resolves.toBeUndefined();
  });
});
