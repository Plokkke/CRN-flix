import { randomUUID } from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';

import {
  CompletedDownload,
  createLogger,
  DownloadMetadata,
  Downloader,
  LiveDownload,
  ResolvedSource,
  Unsubscribe,
} from '@crn-flix/contracts';

export type FakeDownloaderConfig = {
  /** Where finished files land, like the real downloader's folder. */
  downloadsPath: string;
  /** The video every download copies. */
  samplePath: string;
  /** How long a download pretends to take. */
  durationMs: number;
};

const TICK_MS = 1_000;

/** The file a url names: its last path segment, a video name when it has no extension. */
export function fileNameOf(url: string): string {
  const segment = decodeURIComponent(new URL(url).pathname.split('/').pop() ?? '');
  const safe = segment.replace(/[^\w.() [\]-]+/g, '.').replace(/^\.+/, '');
  return path.extname(safe) ? safe : `${safe || 'download'}.mkv`;
}

/**
 * A downloader for the local sandbox: accepts any http(s) url, shows progress for a few
 * seconds, then drops a copy of the sample video named after the url into the downloads
 * folder and reports the completion, as the real one does. Nothing leaves the machine.
 */
export class FakeDownloader implements Downloader {
  private static readonly logger = createLogger(FakeDownloader.name);

  readonly name = 'fake';

  private readonly live = new Map<string, LiveDownload>();
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private readonly liveListeners = new Set<() => void>();
  private readonly completedListeners = new Set<(download: CompletedDownload) => void | Promise<void>>();

  constructor(
    private readonly config: FakeDownloaderConfig,
    private readonly now: () => Date = () => new Date(),
  ) {}

  start(): void {
    FakeDownloader.logger.log(`Fake downloader: every download is a copy of ${this.config.samplePath}`);
  }

  stop(): void {
    this.timers.forEach((timer) => clearInterval(timer));
    this.timers.clear();
  }

  isConnected(): boolean {
    return true;
  }

  async canHandle(url: string): Promise<boolean> {
    return /^https?:\/\//.test(url);
  }

  async resolve(url: string): Promise<ResolvedSource> {
    const { size } = await fs.stat(this.config.samplePath);
    return { fileName: fileNameOf(url), size };
  }

  download(url: string, metadata?: DownloadMetadata): void {
    const id = randomUUID();
    this.live.set(id, {
      id,
      status: 'downloading',
      fileName: fileNameOf(url),
      filePaths: [],
      size: null,
      downloaded: 0,
      progress: 0,
      speed: 0,
      eta: null,
      error: null,
      source: url,
      metadata,
      downloadedAt: null,
      completedAt: null,
    });
    FakeDownloader.logger.log(`Downloading ${url} (pretend, ${this.config.durationMs} ms)`);
    this.changed();
    const steps = Math.max(1, Math.ceil(this.config.durationMs / TICK_MS));
    let step = 0;
    this.timers.set(
      id,
      setInterval(
        () => {
          step += 1;
          if (step >= steps) {
            void this.complete(id);
            return;
          }
          this.patch(id, { progress: Math.round((step / steps) * 100) });
        },
        Math.min(TICK_MS, this.config.durationMs),
      ),
    );
  }

  updateMetadata(downloadId: string, metadata: DownloadMetadata): void {
    this.patch(downloadId, { metadata });
  }

  cancel(downloadId: string): void {
    this.stopTimer(downloadId);
    this.patch(downloadId, { status: 'cancelled' });
  }

  remove(downloadId: string): void {
    this.stopTimer(downloadId);
    this.live.delete(downloadId);
    this.changed();
  }

  liveDownloads(): LiveDownload[] {
    return [...this.live.values()];
  }

  onLiveChanged(listener: () => void): Unsubscribe {
    this.liveListeners.add(listener);
    return () => this.liveListeners.delete(listener);
  }

  onCompleted(listener: (download: CompletedDownload) => void | Promise<void>): Unsubscribe {
    this.completedListeners.add(listener);
    return () => this.completedListeners.delete(listener);
  }

  private async complete(id: string): Promise<void> {
    this.stopTimer(id);
    const download = this.live.get(id);
    if (!download) {
      return;
    }
    const filePath = path.join(this.config.downloadsPath, id, download.fileName);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.copyFile(this.config.samplePath, filePath);
    const { size } = await fs.stat(filePath);
    const at = this.now().toISOString();
    this.patch(id, {
      status: 'completed',
      progress: 100,
      filePaths: [filePath],
      size,
      downloaded: size,
      downloadedAt: at,
      completedAt: at,
    });
    FakeDownloader.logger.log(`Completed ${download.source} → ${filePath}`);
    const completed: CompletedDownload = {
      id,
      fileName: download.fileName,
      filePaths: [filePath],
      size,
      source: download.source,
      metadata: this.live.get(id)?.metadata,
      downloadedAt: at,
      completedAt: at,
    };
    for (const listener of this.completedListeners) {
      await listener(completed);
    }
  }

  private stopTimer(id: string): void {
    clearInterval(this.timers.get(id));
    this.timers.delete(id);
  }

  private patch(id: string, changes: Partial<LiveDownload>): void {
    const current = this.live.get(id);
    if (current) {
      this.live.set(id, { ...current, ...changes });
      this.changed();
    }
  }

  private changed(): void {
    this.liveListeners.forEach((listener) => listener());
  }
}
