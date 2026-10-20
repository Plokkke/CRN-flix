import { AddressInfo } from 'net';

import { WebSocket, WebSocketServer } from 'ws';

import { CompletedDownload, LiveDownload } from '@crn-flix/contracts';

import { FetchrDownloader } from '../src';

type Received = { topic: string; payload: unknown };

const completedPayload = {
  id: 'dl-1',
  fileName: 'Silo.S01E01.mkv',
  filePaths: ['/downloads/Silo/Silo.S01E01.mkv'],
  size: 1000,
  source: 'https://1fichier.com/?abc',
  metadata: { imdbid: 'tt14688458' },
  downloadedAt: '2026-10-20T08:00:00Z',
  completedAt: '2026-10-20T08:10:00Z',
};

function listed(overrides: Partial<LiveDownload>): LiveDownload {
  return {
    ...completedPayload,
    status: 'downloading',
    downloaded: 0,
    progress: null,
    speed: 0,
    eta: null,
    error: null,
    ...overrides,
  };
}

function until(condition: () => boolean, timeoutMs = 2000): Promise<void> {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const tick = (): void => {
      if (condition()) {
        resolve();
      } else if (Date.now() - started > timeoutMs) {
        reject(new Error('condition not met in time'));
      } else {
        setTimeout(tick, 10);
      }
    };
    tick();
  });
}

describe('FetchrDownloader', () => {
  let server: WebSocketServer;
  let socket: WebSocket | null;
  let received: Received[];
  let downloader: FetchrDownloader;

  beforeEach(async () => {
    received = [];
    socket = null;
    server = new WebSocketServer({ port: 0 });
    server.on('connection', (ws) => {
      socket = ws;
      ws.on('message', (raw) => received.push(JSON.parse(raw.toString()) as Received));
    });
    await new Promise((resolve) => server.once('listening', resolve));
    const { port } = server.address() as AddressInfo;
    downloader = new FetchrDownloader({ url: `ws://127.0.0.1:${port}`, downloadsPrefix: '/downloads' }, '/data/dl');
    downloader.start();
    await until(() => socket !== null && downloader.isConnected());
  });

  afterEach(async () => {
    downloader.stop();
    await new Promise((resolve) => server.close(resolve));
  });

  const push = (topic: string, payload: unknown): void => socket!.send(JSON.stringify({ topic, payload }));

  it('subscribes to the download topics once connected', async () => {
    await until(() => received.length > 0);

    expect(received[0].topic).toBe('subscribe');
  });

  it('reports a completion with paths mapped onto the engine downloads directory', async () => {
    const completions: CompletedDownload[] = [];
    downloader.onCompleted((download) => void completions.push(download));

    push('download::completed', completedPayload);
    await until(() => completions.length === 1);

    expect(completions[0]).toMatchObject({ id: 'dl-1', filePaths: ['/data/dl/Silo/Silo.S01E01.mkv'] });
    expect(completions[0].metadata).toEqual({ imdbid: 'tt14688458' });
  });

  it('replays the completed items of a list snapshot and mirrors the live set', async () => {
    const completions: CompletedDownload[] = [];
    let changes = 0;
    downloader.onCompleted((download) => void completions.push(download));
    downloader.onLiveChanged(() => (changes += 1));

    push('download::list', [listed({ id: 'dl-1', status: 'completed' }), listed({ id: 'dl-2' })]);
    await until(() => changes > 0 && completions.length === 1);

    expect(completions.map((c) => c.id)).toEqual(['dl-1']);
    expect(downloader.liveDownloads().map((d) => d.id)).toEqual(['dl-1', 'dl-2']);
  });

  it('stops notifying a listener once unsubscribed', async () => {
    const completions: CompletedDownload[] = [];
    const unsubscribe = downloader.onCompleted((download) => void completions.push(download));
    const kept: CompletedDownload[] = [];
    downloader.onCompleted((download) => void kept.push(download));

    unsubscribe();
    push('download::completed', completedPayload);
    await until(() => kept.length === 1);

    expect(completions).toHaveLength(0);
  });

  it('registers downloads with their correlation metadata', async () => {
    downloader.download('https://1fichier.com/?abc', { 'crn-flix-request-id': 'a1' });
    await until(() => received.some((m) => m.topic === 'download::register'));

    expect(received.find((m) => m.topic === 'download::register')?.payload).toEqual({
      url: 'https://1fichier.com/?abc',
      metadata: { 'crn-flix-request-id': 'a1' },
    });
  });
});
