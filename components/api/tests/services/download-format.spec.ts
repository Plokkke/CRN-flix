import {
  countActive,
  downloadLabel,
  downloadStatusLine,
  formatBytes,
  formatEta,
  formatSpeed,
  progressBar,
  sortForDisplay,
} from '@/services/download-format';
import { LiveDownload } from '@/services/download-live-state';

function buildDownload(overrides: Partial<LiveDownload> = {}): LiveDownload {
  return {
    id: 'dl-1',
    status: 'downloading',
    fileName: 'Some.Movie.2014.1080p.rar',
    filePaths: [],
    size: 4 * 1024 ** 3,
    downloaded: 1024 ** 3,
    progress: 0.25,
    speed: 12 * 1024 ** 2,
    eta: 240,
    error: null,
    source: 'one-fichier',
    downloadedAt: null,
    completedAt: null,
    ...overrides,
  };
}

describe('formatBytes', () => {
  it.each([
    [null, '?'],
    [0, '0 o'],
    [512, '512 o'],
    [1024, '1,0 Ko'],
    [1024 ** 3 * 4, '4,0 Go'],
  ])('formats %p as %p', (input, expected) => {
    expect(formatBytes(input)).toBe(expected);
  });

  it('drops the decimal above 100 units to keep the line short', () => {
    expect(formatBytes(700 * 1024 ** 2)).toBe('700 Mo');
  });
});

describe('formatSpeed', () => {
  it('suffixes the byte size per second', () => {
    expect(formatSpeed(12 * 1024 ** 2)).toBe('12,0 Mo/s');
  });
});

describe('formatEta', () => {
  it.each([
    [null, '—'],
    [0, '—'],
    [45, '45 s'],
    [240, '4 min'],
    [4320, '1 h 12'],
  ])('formats %p as %p', (input, expected) => {
    expect(formatEta(input)).toBe(expected);
  });
});

describe('progressBar', () => {
  it('renders an empty bar for an unknown ratio', () => {
    expect(progressBar(null)).toBe('▱'.repeat(12));
  });

  it('renders a full bar at completion', () => {
    expect(progressBar(1)).toBe('▰'.repeat(12));
  });

  it('clamps a ratio out of bounds', () => {
    expect(progressBar(1.5)).toBe('▰'.repeat(12));
    expect(progressBar(-1)).toBe('▱'.repeat(12));
  });
});

describe('downloadLabel', () => {
  it('falls back to the file name without metadata', () => {
    expect(downloadLabel(buildDownload())).toBe('Some.Movie.2014.1080p.rar');
  });

  it('uses the media identity carried by the download', () => {
    const download = buildDownload({ metadata: { title: 'Interstellar', year: '2014' } });

    expect(downloadLabel(download)).toBe('Interstellar (2014)');
  });

  it('appends a padded episode number for series', () => {
    const download = buildDownload({
      metadata: { title: 'Severance', year: '2022', season: '2', episode: '7' },
    });

    expect(downloadLabel(download)).toBe('Severance (2022) — S02E07');
  });
});

describe('downloadStatusLine', () => {
  it('shows the bar, volume, speed and eta while downloading', () => {
    const line = downloadStatusLine(buildDownload());

    expect(line).toContain('25 %');
    expect(line).toContain('1,0 Go / 4,0 Go');
    expect(line).toContain('12,0 Mo/s');
    expect(line).toContain('~4 min');
  });

  it('surfaces the error on failure', () => {
    const line = downloadStatusLine(buildDownload({ status: 'failed', error: 'quota exceeded' }));

    expect(line).toBe('❌ Échec — quota exceeded');
  });

  it('stays readable when a failure carries no message', () => {
    expect(downloadStatusLine(buildDownload({ status: 'failed', error: null }))).toContain('erreur inconnue');
  });

  it('labels the non-downloading states', () => {
    expect(downloadStatusLine(buildDownload({ status: 'extracting' }))).toContain('Extraction');
    expect(downloadStatusLine(buildDownload({ status: 'queued' }))).toContain('En attente');
  });

  it('falls back to the raw status for one it does not know', () => {
    expect(downloadStatusLine(buildDownload({ status: 'teleporting' }))).toBe('teleporting');
  });
});

describe('sortForDisplay', () => {
  it('puts what is moving first and terminal states last', () => {
    const downloads = [
      buildDownload({ id: 'a', status: 'completed' }),
      buildDownload({ id: 'b', status: 'queued' }),
      buildDownload({ id: 'c', status: 'downloading' }),
      buildDownload({ id: 'd', status: 'failed' }),
    ];

    expect(sortForDisplay(downloads).map(({ id }) => id)).toEqual(['c', 'b', 'd', 'a']);
  });

  it('does not mutate the input', () => {
    const downloads = [buildDownload({ id: 'a', status: 'completed' }), buildDownload({ id: 'b', status: 'queued' })];

    sortForDisplay(downloads);

    expect(downloads.map(({ id }) => id)).toEqual(['a', 'b']);
  });
});

describe('countActive', () => {
  it('excludes the terminal states', () => {
    const downloads = [
      buildDownload({ status: 'downloading' }),
      buildDownload({ status: 'extracting' }),
      buildDownload({ status: 'completed' }),
      buildDownload({ status: 'failed' }),
    ];

    expect(countActive(downloads)).toBe(2);
  });
});
