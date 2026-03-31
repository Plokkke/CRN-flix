import * as path from 'path';

import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import * as WebSocket from 'ws';

import { DownloadJobsRepository } from './database/download-jobs';

type FetchrCompletedEvent = {
  id: string;
  fileName: string;
  filePaths: string[];
  size: number | null;
  source: string;
  downloadedAt: string;
  completedAt: string;
};

type FetchrMessage = {
  event: string;
  data: FetchrCompletedEvent;
};

@Injectable()
export class FetchrSyncService implements OnModuleInit, OnModuleDestroy {
  private static readonly logger = new Logger(FetchrSyncService.name);

  private ws: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly downloadJobs: DownloadJobsRepository,
    private readonly fetchrUrl: string,
    private readonly fetchrPrefix: string,
    private readonly localPrefix: string,
  ) {}

  onModuleInit(): void {
    this.connect();
  }

  onModuleDestroy(): void {
    this.disconnect();
  }

  private connect(): void {
    if (this.ws) return;

    FetchrSyncService.logger.log(`Connecting to Fetchr at ${this.fetchrUrl}`);
    this.ws = new WebSocket(this.fetchrUrl);

    this.ws.on('open', () => {
      FetchrSyncService.logger.log('Connected to Fetchr WebSocket');
      this.subscribe();
    });

    this.ws.on('message', (raw: Buffer | string) => {
      try {
        const msg: FetchrMessage = JSON.parse(raw.toString());
        this.handleMessage(msg);
      } catch (error) {
        FetchrSyncService.logger.warn(`Invalid Fetchr WS message: ${error}`);
      }
    });

    this.ws.on('close', () => {
      FetchrSyncService.logger.warn('Fetchr WebSocket disconnected, reconnecting in 5s...');
      this.ws = null;
      this.scheduleReconnect();
    });

    this.ws.on('error', (error) => {
      FetchrSyncService.logger.error(`Fetchr WebSocket error: ${error.message}`);
      this.ws?.close();
    });
  }

  private disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, 5000);
  }

  private subscribe(): void {
    this.send({ type: 'subscribe', topics: ['download.completed'] });
  }

  private send(data: unknown): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }

  remove(downloadId: string): void {
    this.send({ type: 'remove', id: downloadId });
  }

  private mapPath(fetchrPath: string): string {
    if (fetchrPath.startsWith(this.fetchrPrefix)) {
      return fetchrPath.replace(this.fetchrPrefix, this.localPrefix);
    }
    return fetchrPath;
  }

  private async handleMessage(msg: FetchrMessage): Promise<void> {
    if (msg.event !== 'download.completed') return;

    const data = msg.data;
    FetchrSyncService.logger.log(`Fetchr download completed: ${data.fileName} (${data.filePaths.length} files)`);

    const localPaths = data.filePaths.map((p) => this.mapPath(p));
    const saveTo = localPaths.length > 0 ? path.dirname(localPaths[0]) : '';

    await this.downloadJobs.create({
      sourceId: data.id,
      packageName: data.fileName,
      saveTo,
      sourcePaths: localPaths,
    });
  }
}
