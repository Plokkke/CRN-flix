import * as crypto from 'crypto';

import { Logger } from '@nestjs/common';
import axios from 'axios';
import { z } from 'zod';

export const jdownloaderConfigSchema = z.object({
  email: z.string(),
  password: z.string(),
  deviceName: z.string(),
});

export type JDownloaderConfig = z.infer<typeof jdownloaderConfigSchema>;

type JDDevice = {
  id: string;
  name: string;
};

export type JDPackage = {
  uuid: number;
  name: string;
  finished: boolean;
  bytesLoaded: number;
  bytesTotal: number;
  status: string;
  saveTo: string;
};

export enum JDExtractionStatus {
  NA = 'NA',
  IDLE = 'IDLE',
  RUNNING = 'RUNNING',
  SUCCESSFUL = 'SUCCESSFUL',
  ERROR = 'ERROR',
  ERROR_PW = 'ERROR_PW',
  ERROR_CRC = 'ERROR_CRC',
  ERROR_NOT_ENOUGH_SPACE = 'ERROR_NOT_ENOUGH_SPACE',
  ERROR_FILE_NOT_FOUND = 'ERRROR_FILE_NOT_FOUND',
}

export type JDLink = {
  uuid: number;
  name: string;
  packageUUID: number;
  bytesLoaded: number;
  bytesTotal: number;
  finished: boolean;
  status: string;
  extractionStatus: JDExtractionStatus | null;
};

function deriveKey(email: string, password: string, domain: string): Buffer {
  const combined = `${email.toLowerCase()}${password}${domain}`;
  return crypto.createHash('sha256').update(combined).digest();
}

function encrypt(data: string, key: Buffer): string {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
  const encrypted = Buffer.concat([cipher.update(data, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, encrypted]).toString('base64');
}

function decrypt(data: string, key: Buffer): string {
  const raw = Buffer.from(data, 'base64');
  const iv = raw.subarray(0, 16);
  const encrypted = raw.subarray(16);
  const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}

function hmacSign(key: Buffer, data: string): string {
  return crypto.createHmac('sha256', key).update(data).digest('hex');
}

function updateKey(oldKey: Buffer, sessionToken: string): Buffer {
  return crypto
    .createHash('sha256')
    .update(Buffer.concat([oldKey, Buffer.from(sessionToken, 'hex')]))
    .digest();
}

export class JDownloaderApiService {
  private static readonly logger = new Logger(JDownloaderApiService.name);
  private static readonly BASE_URL = 'https://api.jdownloader.org';

  private readonly loginSecret: Buffer;
  private readonly deviceSecret: Buffer;
  private sessionToken: string | null = null;
  private serverEncryptionToken: Buffer | null = null;
  private deviceEncryptionToken: Buffer | null = null;
  private deviceId: string | null = null;
  private requestId = 0;

  constructor(private readonly config: JDownloaderConfig) {
    this.loginSecret = deriveKey(config.email, config.password, 'server');
    this.deviceSecret = deriveKey(config.email, config.password, 'device');
  }

  private async connect(): Promise<void> {
    const query = `/my/connect?email=${encodeURIComponent(this.config.email)}&appkey=crn-flix`;
    const signature = hmacSign(this.loginSecret, query);
    const url = `${JDownloaderApiService.BASE_URL}${query}&signature=${signature}`;

    const response = await axios.get(url);
    const decrypted = JSON.parse(decrypt(response.data, this.loginSecret));

    this.sessionToken = decrypted.sessiontoken;
    this.serverEncryptionToken = updateKey(this.loginSecret, this.sessionToken!);
    this.deviceEncryptionToken = updateKey(this.deviceSecret, this.sessionToken!);

    JDownloaderApiService.logger.log('Connected to MyJDownloader');
  }

  private async resolveDevice(): Promise<void> {
    const devices = await this.callServer<JDDevice[]>('/my/listdevices');
    const device = devices.find((d) => d.name === this.config.deviceName);
    if (!device) {
      throw new Error(
        `JDownloader device "${this.config.deviceName}" not found. Available: ${devices.map((d) => d.name).join(', ')}`,
      );
    }
    this.deviceId = device.id;
    JDownloaderApiService.logger.log(`Resolved device: ${device.name} (${device.id})`);
  }

  private async ensureConnected(): Promise<void> {
    if (!this.sessionToken) {
      await this.connect();
      await this.resolveDevice();
    }
  }

  private nextRid(): number {
    const rid = this.requestId;
    this.requestId += 1;
    return rid;
  }

  private async callServer<T>(path: string): Promise<T> {
    const rid = this.nextRid();
    const query = `${path}${path.includes('?') ? '&' : '?'}signature=${hmacSign(this.serverEncryptionToken!, `${path}&rid=${rid}`)}&rid=${rid}`;
    const url = `${JDownloaderApiService.BASE_URL}${query}`;

    const response = await axios.get(url);
    const result = JSON.parse(decrypt(response.data, this.serverEncryptionToken!));
    return result.list ?? result.data;
  }

  private async callDevice<T>(action: string, params?: unknown[]): Promise<T> {
    await this.ensureConnected();

    const rid = this.nextRid();
    const postData = JSON.stringify({
      apiVer: 1,
      url: action,
      params: params ?? [],
      rid,
    });

    const encrypted = encrypt(postData, this.deviceEncryptionToken!);
    const query = `/t_${this.sessionToken}_${this.deviceId}${action}`;
    const signature = hmacSign(this.deviceEncryptionToken!, query);

    const url = `${JDownloaderApiService.BASE_URL}${query}?signature=${signature}&rid=${rid}`;
    const response = await axios.post(url, encrypted, {
      headers: { 'Content-Type': 'application/aesjson-jd; charset=utf-8' },
    });

    const result = JSON.parse(decrypt(response.data, this.deviceEncryptionToken!));
    return result.data;
  }

  async disconnect(): Promise<void> {
    if (this.sessionToken) {
      try {
        await this.callServer('/my/disconnect');
      } catch {
        // ignore disconnect errors
      }
      this.sessionToken = null;
      this.serverEncryptionToken = null;
      this.deviceEncryptionToken = null;
    }
  }

  async reconnect(): Promise<void> {
    this.sessionToken = null;
    await this.ensureConnected();
  }

  async queryPackages(): Promise<JDPackage[]> {
    try {
      return await this.callDevice<JDPackage[]>('/downloadsV2/queryPackages', [
        {
          bytesLoaded: true,
          bytesTotal: true,
          finished: true,
          status: true,
          saveTo: true,
        },
      ]);
    } catch (error) {
      JDownloaderApiService.logger.warn(
        `queryPackages failed, reconnecting: ${error instanceof Error ? error.message : error}`,
      );
      await this.reconnect();
      return this.callDevice<JDPackage[]>('/downloadsV2/queryPackages', [
        {
          bytesLoaded: true,
          bytesTotal: true,
          finished: true,
          status: true,
          saveTo: true,
        },
      ]);
    }
  }

  async queryLinks(packageIds: number[]): Promise<JDLink[]> {
    return this.callDevice<JDLink[]>('/downloadsV2/queryLinks', [
      {
        bytesLoaded: true,
        bytesTotal: true,
        finished: true,
        status: true,
        extractionStatus: true,
        packageUUIDs: packageIds,
      },
    ]);
  }

  async cleanupPackages(packageIds: number[]): Promise<void> {
    await this.callDevice('/downloadsV2/removeLinks', [[], packageIds]);
  }
}
