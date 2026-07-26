import { applyFetchrEvent, LiveDownload } from '@/services/download-live-state';

function buildDownload(overrides: Partial<LiveDownload> = {}): LiveDownload {
  return {
    id: 'dl-1',
    status: 'downloading',
    fileName: 'movie.part1.rar',
    filePaths: [],
    size: 1_000,
    downloaded: 250,
    progress: 0.25,
    speed: 1_024,
    eta: 120,
    error: null,
    source: 'one-fichier',
    metadata: { 'crn-flix-request-id': 'req-1' },
    downloadedAt: null,
    completedAt: null,
    ...overrides,
  };
}

describe('applyFetchrEvent', () => {
  it('replaces the whole set on a list snapshot', () => {
    const live = new Map([['stale', buildDownload({ id: 'stale' })]]);

    const changed = applyFetchrEvent(live, {
      topic: 'download::list',
      payload: [buildDownload({ id: 'dl-1' }), buildDownload({ id: 'dl-2' })],
    });

    expect(changed).toBe(true);
    expect([...live.keys()]).toEqual(['dl-1', 'dl-2']);
  });

  it('adds a newly registered download', () => {
    const live = new Map<string, LiveDownload>();

    applyFetchrEvent(live, { topic: 'download::registered', payload: buildDownload() });

    expect(live.get('dl-1')?.status).toBe('downloading');
  });

  it('merges progress without losing fields the event omits', () => {
    const live = new Map([['dl-1', buildDownload()]]);

    applyFetchrEvent(live, {
      topic: 'download::progress',
      payload: {
        id: 'dl-1',
        status: 'downloading',
        fileName: 'movie.part1.rar',
        progress: 0.5,
        speed: 2_048,
        eta: 60,
        downloaded: 500,
      },
    });

    const merged = live.get('dl-1')!;
    expect(merged.progress).toBe(0.5);
    expect(merged.metadata).toEqual({ 'crn-flix-request-id': 'req-1' });
    expect(merged.size).toBe(1_000);
  });

  it('takes the status carried by a progress event', () => {
    const live = new Map([['dl-1', buildDownload()]]);

    applyFetchrEvent(live, {
      topic: 'download::progress',
      payload: {
        id: 'dl-1',
        status: 'extracting',
        fileName: 'movie.part1.rar',
        progress: 1,
        speed: 0,
        eta: null,
        downloaded: 1_000,
      },
    });

    expect(live.get('dl-1')?.status).toBe('extracting');
  });

  it('forces the status on completion, which the payload does not carry', () => {
    const live = new Map([['dl-1', buildDownload()]]);

    applyFetchrEvent(live, {
      topic: 'download::completed',
      payload: { id: 'dl-1', fileName: 'movie.mkv', filePaths: ['/downloads/movie.mkv'], size: 1_000 },
    });

    expect(live.get('dl-1')?.status).toBe('completed');
  });

  it('forces the status and keeps the error on failure', () => {
    const live = new Map([['dl-1', buildDownload()]]);

    applyFetchrEvent(live, {
      topic: 'download::failed',
      payload: { id: 'dl-1', fileName: 'movie.part1.rar', error: 'quota exceeded', source: 'one-fichier' },
    });

    expect(live.get('dl-1')).toMatchObject({ status: 'failed', error: 'quota exceeded' });
  });

  it('drops the entry on cancel and on removal', () => {
    const live = new Map([['dl-1', buildDownload()]]);

    expect(applyFetchrEvent(live, { topic: 'download::canceled', payload: { id: 'dl-1' } })).toBe(true);
    expect(live.size).toBe(0);
    expect(applyFetchrEvent(live, { topic: 'download::removed', payload: { id: 'dl-1' } })).toBe(false);
  });

  it('ignores an update for a download it never saw', () => {
    const live = new Map<string, LiveDownload>();

    const changed = applyFetchrEvent(live, {
      topic: 'download::progress',
      payload: { id: 'ghost', status: 'downloading', fileName: 'x', progress: 0.1, speed: 1, eta: 1, downloaded: 1 },
    });

    expect(changed).toBe(false);
    expect(live.size).toBe(0);
  });

  it('ignores unrelated topics', () => {
    const live = new Map([['dl-1', buildDownload()]]);

    expect(applyFetchrEvent(live, { topic: 'settings::plugins', payload: {} })).toBe(false);
  });
});
