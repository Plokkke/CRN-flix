import axios from 'axios';
import { WebSocket } from 'ws';
import { z } from 'zod';

import {
  CompletedDownload,
  createLogger,
  DownloadMetadata,
  Downloader,
  LiveDownload,
  ResolvedSource,
  Unsubscribe,
} from '@crn-flix/contracts';

import { applyFetchrEvent } from './live-state';

export const fetchrConfigSchema = z.object({
  url: z.string(),
  apiKey: z.string().optional(),
  /** Fetchr's own download directory, mapped onto the engine's in reported paths. */
  downloadsPrefix: z.string(),
});

export type FetchrConfig = z.infer<typeof fetchrConfigSchema>;

type FetchrMessage =
  | { topic: 'download::completed'; payload: CompletedDownload }
  | { topic: 'download::list'; payload: LiveDownload[] }
  | { topic: string; payload: unknown };

/** Topics carrying live state, on top of the ones reporting completions. */
const SUBSCRIBED_TOPICS = [
  'download::completed',
  'download::list',
  'download::registered',
  'download::progress',
  'download::failed',
  'download::canceled',
  'download::removed',
  'download::updated',
];

const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 60000;
const HEARTBEAT_INTERVAL_MS = 30000;
const HEARTBEAT_TIMEOUT_MS = 10000;
const MAX_MISSED_PONGS = 2;
const PLUGINS_CACHE_TTL_MS = 5 * 60 * 1000;
const PLUGINS_REQUEST_TIMEOUT_MS = 5000;

type FetchrPluginInfo = { name: string; urlPattern: string };
type CompiledPlugin = { name: string; pattern: RegExp };
type CompletionListener = (download: CompletedDownload) => void | Promise<void>;

/**
 * Mirrors Fetchr over its WebSocket: live state in memory only (the `download::list`
 * snapshot replayed on every reconnect is authoritative) and completions reported to
 * the engine — including completed items of that snapshot, which may have been missed.
 */
export class FetchrDownloader implements Downloader {
  private static readonly logger = createLogger(FetchrDownloader.name);

  readonly name = 'fetchr';

  private readonly live = new Map<string, LiveDownload>();
  private readonly liveListeners = new Set<() => void>();
  private readonly completionListeners = new Set<CompletionListener>();

  private ws: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private pongDeadline: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempt = 0;
  private missedPongs = 0;
  private shuttingDown = false;
  private readonly apiUrl: string;
  private pluginsCache: { fetchedAt: number; plugins: CompiledPlugin[] } | null = null;

  constructor(
    private readonly config: FetchrConfig,
    private readonly localDownloadsPath: string,
  ) {
    this.apiUrl = config.url.replace(/^ws/, 'http');
  }

  /** Snapshot of everything Fetchr currently holds. */
  liveDownloads(): LiveDownload[] {
    return [...this.live.values()];
  }

  onLiveChanged(listener: () => void): Unsubscribe {
    this.liveListeners.add(listener);
    return () => this.liveListeners.delete(listener);
  }

  onCompleted(listener: CompletionListener): Unsubscribe {
    this.completionListeners.add(listener);
    return () => this.completionListeners.delete(listener);
  }

  start(): void {
    this.shuttingDown = false;
    this.connect();
  }

  stop(): void {
    this.shuttingDown = true;
    this.disconnect();
  }

  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  remove(downloadId: string): void {
    this.send({ topic: 'download::remove', payload: { id: downloadId } });
  }

  cancel(downloadId: string): void {
    this.send({ topic: 'download::cancel', payload: { id: downloadId } });
  }

  updateMetadata(downloadId: string, metadata: DownloadMetadata): void {
    this.send({ topic: 'download::update', payload: { id: downloadId, metadata } });
  }

  download(url: string, metadata?: DownloadMetadata): void {
    this.send({ topic: 'download::register', payload: { url, metadata } });
  }

  async resolve(url: string): Promise<ResolvedSource> {
    const response = await axios.get<ResolvedSource>(`${this.apiUrl}/downloads/resolve`, {
      params: { url },
      headers: this.authHeaders(),
    });
    return response.data;
  }

  async canHandle(url: string): Promise<boolean> {
    const plugins = await this.getPlugins();
    return plugins.some((p) => p.pattern.test(url));
  }

  private authHeaders(): Record<string, string> | undefined {
    return this.config.apiKey ? { 'x-api-key': this.config.apiKey } : undefined;
  }

  private connect(): void {
    if (this.ws) {
      return;
    }

    const authMode = this.config.apiKey ? 'with api key' : 'without api key';
    FetchrDownloader.logger.log(`Connecting to Fetchr at ${this.config.url} (${authMode})`);
    this.ws = new WebSocket(this.config.url, { headers: this.authHeaders() });

    this.ws.on('open', () => {
      FetchrDownloader.logger.log('Connected to Fetchr WebSocket');
      this.reconnectAttempt = 0;
      this.missedPongs = 0;
      this.send({ topic: 'subscribe', payload: { topics: SUBSCRIBED_TOPICS } });
      this.startHeartbeat();
    });

    this.ws.on('message', (raw: Buffer | string) => {
      try {
        void this.handleMessage(JSON.parse(raw.toString()) as FetchrMessage);
      } catch (error) {
        FetchrDownloader.logger.warn(`Invalid Fetchr WS message: ${error}`);
      }
    });

    this.ws.on('pong', () => {
      this.missedPongs = 0;
      this.clearPongDeadline();
    });

    this.ws.on('close', () => {
      FetchrDownloader.logger.warn('Fetchr WebSocket disconnected');
      this.ws = null;
      this.stopHeartbeat();
      this.scheduleReconnect();
    });

    this.ws.on('error', (error) => {
      FetchrDownloader.logger.error(`Fetchr WebSocket error: ${error.message}`);
      this.ws?.close();
    });
  }

  private disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.stopHeartbeat();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.shuttingDown || this.reconnectTimer) {
      return;
    }
    const delay = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** this.reconnectAttempt) * (0.5 + Math.random());
    this.reconnectAttempt += 1;
    FetchrDownloader.logger.log(`Reconnecting to Fetchr in ${Math.round(delay)}ms (attempt ${this.reconnectAttempt})`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (this.ws?.readyState !== WebSocket.OPEN) {
        return;
      }
      try {
        this.ws.ping();
      } catch {
        /* ignore */
      }
      this.clearPongDeadline();
      this.pongDeadline = setTimeout(() => this.onMissedPong(), HEARTBEAT_TIMEOUT_MS);
    }, HEARTBEAT_INTERVAL_MS);
  }

  private onMissedPong(): void {
    this.missedPongs += 1;
    FetchrDownloader.logger.warn(`Missed Fetchr WS pong (${this.missedPongs}/${MAX_MISSED_PONGS})`);
    if (this.missedPongs >= MAX_MISSED_PONGS) {
      FetchrDownloader.logger.warn('Fetchr WS heartbeat timeout, forcing reconnect');
      this.ws?.close();
    }
  }

  private clearPongDeadline(): void {
    if (this.pongDeadline) {
      clearTimeout(this.pongDeadline);
      this.pongDeadline = null;
    }
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    this.clearPongDeadline();
  }

  private send(data: unknown): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }

  private async getPlugins(): Promise<CompiledPlugin[]> {
    const now = Date.now();
    if (this.pluginsCache && now - this.pluginsCache.fetchedAt < PLUGINS_CACHE_TTL_MS) {
      return this.pluginsCache.plugins;
    }

    try {
      const response = await axios.get<{ hosts?: FetchrPluginInfo[] }>(`${this.apiUrl}/plugins`, {
        headers: this.authHeaders(),
        timeout: PLUGINS_REQUEST_TIMEOUT_MS,
      });
      const compiled = (response.data?.hosts ?? []).flatMap((info) => {
        try {
          return [{ name: info.name, pattern: new RegExp(info.urlPattern) }];
        } catch {
          FetchrDownloader.logger.debug(`Invalid Fetchr plugin urlPattern: ${info.urlPattern}`);
          return [];
        }
      });
      this.pluginsCache = { fetchedAt: now, plugins: compiled };
      return compiled;
    } catch (err) {
      FetchrDownloader.logger.warn(`Failed to fetch Fetchr plugins: ${(err as Error).message}`);
      return this.pluginsCache?.plugins ?? [];
    }
  }

  private mapPath(fetchrPath: string): string {
    return fetchrPath.startsWith(this.config.downloadsPrefix)
      ? fetchrPath.replace(this.config.downloadsPrefix, this.localDownloadsPath)
      : fetchrPath;
  }

  private async handleMessage(msg: FetchrMessage): Promise<void> {
    if (applyFetchrEvent(this.live, msg)) {
      this.liveListeners.forEach((listener) => listener());
    }

    if (msg.topic === 'download::completed') {
      await this.reportCompleted(msg.payload as CompletedDownload);
    } else if (msg.topic === 'download::list') {
      await this.reportListedCompletions(msg.payload as LiveDownload[]);
    }
  }

  private async reportCompleted(download: CompletedDownload): Promise<void> {
    FetchrDownloader.logger.log(
      `Fetchr download completed: ${download.fileName} (${download.filePaths.length} files, sourceId=${download.id})`,
    );
    await this.notifyCompleted(download);
  }

  private async notifyCompleted(download: CompletedDownload): Promise<void> {
    const completed = { ...download, filePaths: download.filePaths.map((p) => this.mapPath(p)) };
    for (const listener of this.completionListeners) {
      await listener(completed);
    }
  }

  /** Completions that happened while disconnected only show up in the snapshot. */
  private async reportListedCompletions(items: LiveDownload[]): Promise<void> {
    const now = new Date().toISOString();
    for (const item of items.filter((i) => i.status === 'completed')) {
      await this.notifyCompleted({
        id: item.id,
        fileName: item.fileName,
        filePaths: item.filePaths,
        size: item.size,
        source: item.source,
        metadata: item.metadata,
        downloadedAt: item.downloadedAt ?? now,
        completedAt: item.completedAt ?? now,
      });
    }
  }
}
