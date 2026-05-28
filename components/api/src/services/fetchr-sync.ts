import * as path from 'path';

import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import axios from 'axios';
import { WebSocket } from 'ws';

import { withDbRetry } from '@/helpers/db-retry';

import { DownloadJobsRepository } from './database/download-jobs';

type FetchrCompletedEvent = {
  id: string;
  fileName: string;
  filePaths: string[];
  size: number | null;
  source: string;
  metadata?: Record<string, string>;
  downloadedAt: string;
  completedAt: string;
};

type FetchrListItem = {
  id: string;
  status: string;
  fileName: string;
  filePaths: string[];
  size: number | null;
  source: string;
  metadata?: Record<string, string>;
  downloadedAt: string | null;
  completedAt: string | null;
};

type FetchrMessage =
  | { topic: 'download::completed'; payload: FetchrCompletedEvent }
  | { topic: 'download::list'; payload: FetchrListItem[] }
  | { topic: string; payload: unknown };

const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 60000;
const HEARTBEAT_INTERVAL_MS = 30000;
const HEARTBEAT_TIMEOUT_MS = 10000;
const MAX_MISSED_PONGS = 2;

@Injectable()
export class FetchrSyncService implements OnModuleInit, OnModuleDestroy {
  private static readonly logger = new Logger(FetchrSyncService.name);

  private ws: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private pongDeadline: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempt = 0;
  private missedPongs = 0;
  private shuttingDown = false;
  private readonly fetchrApiUrl: string;

  constructor(
    private readonly downloadJobs: DownloadJobsRepository,
    private readonly fetchrUrl: string,
    private readonly fetchrPrefix: string,
    private readonly localPrefix: string,
    private readonly fetchrApiKey?: string,
  ) {
    this.fetchrApiUrl = fetchrUrl.replace(/^ws/, 'http');
  }

  onModuleInit(): void {
    this.connect();
  }

  onModuleDestroy(): void {
    this.shuttingDown = true;
    this.disconnect();
  }

  private connect(): void {
    if (this.ws) {
      return;
    }

    const authMode = this.fetchrApiKey ? 'with api key' : 'without api key';
    FetchrSyncService.logger.log(`Connecting to Fetchr at ${this.fetchrUrl} (${authMode})`);
    const headers = this.fetchrApiKey ? { 'x-api-key': this.fetchrApiKey } : undefined;
    this.ws = new WebSocket(this.fetchrUrl, { headers });

    this.ws.on('open', () => {
      FetchrSyncService.logger.log('Connected to Fetchr WebSocket');
      this.reconnectAttempt = 0;
      this.missedPongs = 0;
      this.subscribe();
      this.startHeartbeat();
    });

    this.ws.on('message', (raw: Buffer | string) => {
      try {
        const msg = JSON.parse(raw.toString()) as FetchrMessage;
        void this.handleMessage(msg);
      } catch (error) {
        FetchrSyncService.logger.warn(`Invalid Fetchr WS message: ${error}`);
      }
    });

    this.ws.on('pong', () => {
      this.missedPongs = 0;
      if (this.pongDeadline) {
        clearTimeout(this.pongDeadline);
        this.pongDeadline = null;
      }
    });

    this.ws.on('close', () => {
      FetchrSyncService.logger.warn('Fetchr WebSocket disconnected');
      this.cleanupSocket();
      this.scheduleReconnect();
    });

    this.ws.on('error', (error) => {
      FetchrSyncService.logger.error(`Fetchr WebSocket error: ${error.message}`);
      this.ws?.close();
    });
  }

  private cleanupSocket(): void {
    this.ws = null;
    this.stopHeartbeat();
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
    FetchrSyncService.logger.log(`Reconnecting to Fetchr in ${Math.round(delay)}ms (attempt ${this.reconnectAttempt})`);
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
      if (this.pongDeadline) {
        clearTimeout(this.pongDeadline);
      }
      this.pongDeadline = setTimeout(() => {
        this.missedPongs += 1;
        FetchrSyncService.logger.warn(`Missed Fetchr WS pong (${this.missedPongs}/${MAX_MISSED_PONGS})`);
        if (this.missedPongs >= MAX_MISSED_PONGS) {
          FetchrSyncService.logger.warn('Fetchr WS heartbeat timeout, forcing reconnect');
          this.ws?.close();
        }
      }, HEARTBEAT_TIMEOUT_MS);
    }, HEARTBEAT_INTERVAL_MS);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.pongDeadline) {
      clearTimeout(this.pongDeadline);
      this.pongDeadline = null;
    }
  }

  private subscribe(): void {
    this.send({
      topic: 'subscribe',
      payload: { topics: ['download::completed', 'download::list'] },
    });
  }

  private send(data: unknown): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }

  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  remove(downloadId: string): void {
    this.send({ topic: 'download::remove', payload: { id: downloadId } });
  }

  async resolve(url: string): Promise<{ fileName: string; size: number | null }> {
    const headers: Record<string, string> = {};
    if (this.fetchrApiKey) {
      headers['x-api-key'] = this.fetchrApiKey;
    }
    const response = await axios.get<{ fileName: string; size: number | null }>(`${this.fetchrApiUrl}/infos`, {
      params: { url },
      headers,
    });
    return response.data;
  }

  download(url: string, metadata?: Record<string, string>): void {
    this.send({ topic: 'download::register', payload: { url, metadata } });
  }

  private mapPath(fetchrPath: string): string {
    if (fetchrPath.startsWith(this.fetchrPrefix)) {
      return fetchrPath.replace(this.fetchrPrefix, this.localPrefix);
    }
    return fetchrPath;
  }

  private async handleMessage(msg: FetchrMessage): Promise<void> {
    if (msg.topic === 'download::completed') {
      await this.handleCompleted(msg.payload as FetchrCompletedEvent);
      return;
    }
    if (msg.topic === 'download::list') {
      await this.handleList(msg.payload as FetchrListItem[]);
      return;
    }
  }

  private async handleCompleted(data: FetchrCompletedEvent): Promise<void> {
    FetchrSyncService.logger.log(
      `Fetchr download completed: ${data.fileName} (${data.filePaths.length} files, sourceId=${data.id})`,
    );

    const localPaths = data.filePaths.map((p) => this.mapPath(p));
    const saveTo = localPaths.length > 0 ? path.dirname(localPaths[0]) : '';

    try {
      await withDbRetry(
        () =>
          this.downloadJobs.create({
            sourceId: data.id,
            packageName: data.fileName,
            saveTo,
            sourcePaths: localPaths,
            metadata: data.metadata,
          }),
        { label: 'fetchrSync.create', attempts: 6, baseMs: 500, maxMs: 8000 },
      );
    } catch (err) {
      FetchrSyncService.logger.error(
        `Failed to persist completed download ${data.id} (${data.fileName}) after retries: ${(err as Error).message}. Fetchr will replay on next reconnect.`,
      );
    }
  }

  private async handleList(items: FetchrListItem[]): Promise<void> {
    const completed = items.filter((i) => i.status === 'completed');
    if (completed.length === 0) {
      return;
    }

    let reconciled = 0;
    for (const item of completed) {
      const existing = await this.downloadJobs.getBySourceId(item.id).catch(() => null);
      if (existing) {
        continue;
      }
      FetchrSyncService.logger.log(`Reconciling missed completion: ${item.fileName} (sourceId=${item.id})`);
      await this.handleCompleted({
        id: item.id,
        fileName: item.fileName,
        filePaths: item.filePaths,
        size: item.size,
        source: item.source,
        metadata: item.metadata,
        downloadedAt: item.downloadedAt ?? new Date().toISOString(),
        completedAt: item.completedAt ?? new Date().toISOString(),
      });
      reconciled += 1;
    }
    if (reconciled > 0) {
      FetchrSyncService.logger.log(`Reconciled ${reconciled} missed completion(s) from Fetchr list`);
    }
  }
}
