import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

import { CompletedDownload } from '@crn-flix/contracts';

import { FakeDownloader, fileNameOf } from '../src';

describe('fileNameOf', () => {
  it('takes the last path segment, a video name when it has no extension', () => {
    expect(fileNameOf('https://example.invalid/files/Inception.2010.1080p.mkv?x=1')).toBe('Inception.2010.1080p.mkv');
    expect(fileNameOf('https://example.invalid/d/AbC123')).toBe('AbC123.mkv');
    expect(fileNameOf('https://example.invalid/')).toBe('download.mkv');
  });
});

describe('FakeDownloader', () => {
  let root: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'crn-flix-fake-dl-'));
    await fs.writeFile(path.join(root, 'sample.mkv'), 'video');
  });

  afterEach(() => fs.rm(root, { recursive: true, force: true }));

  const build = () =>
    new FakeDownloader({
      downloadsPath: path.join(root, 'downloads'),
      samplePath: path.join(root, 'sample.mkv'),
      durationMs: 20,
    });

  it('handles any http(s) url and resolves its file name', async () => {
    const downloader = build();

    await expect(downloader.canHandle('https://1fichier.com/?abc')).resolves.toBe(true);
    await expect(downloader.canHandle('magnet:?xt=urn')).resolves.toBe(false);
    await expect(downloader.resolve('https://x.invalid/Cars.2006.mkv')).resolves.toEqual({
      fileName: 'Cars.2006.mkv',
      size: 5,
    });
  });

  it('drops a copy of the sample named after the url and reports it with the metadata, as the real one does', async () => {
    const downloader = build();
    const completed = new Promise<CompletedDownload>((resolve) => downloader.onCompleted(resolve));

    downloader.download('https://x.invalid/Inception.2010.mkv', { 'crn-flix-request-id': 'r1' });
    downloader.updateMetadata(downloader.liveDownloads()[0].id, { 'crn-flix-request-id': 'r2' });
    const done = await completed;

    expect(done.fileName).toBe('Inception.2010.mkv');
    expect(done.metadata).toEqual({ 'crn-flix-request-id': 'r2' });
    await expect(fs.readFile(done.filePaths[0], 'utf8')).resolves.toBe('video');
    expect(downloader.liveDownloads()[0]).toMatchObject({ status: 'completed', progress: 100 });
    downloader.stop();
  });

  it('stops a cancelled download before it completes', async () => {
    const downloader = build();
    const onCompleted = jest.fn();
    downloader.onCompleted(onCompleted);

    downloader.download('https://x.invalid/Alien.mkv');
    downloader.cancel(downloader.liveDownloads()[0].id);
    await new Promise((resolve) => setTimeout(resolve, 60));

    expect(onCompleted).not.toHaveBeenCalled();
    expect(downloader.liveDownloads()[0].status).toBe('cancelled');
  });
});
