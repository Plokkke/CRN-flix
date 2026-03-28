import * as crypto from 'crypto';

import { Logger } from '@nestjs/common';
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

function encrypt(data: string, ivKey: Buffer): string {
  const iv = ivKey.subarray(0, 16);
  const key = ivKey.subarray(16);
  const cipher = crypto.createCipheriv('aes-128-cbc', key, iv);
  const encrypted = Buffer.concat([cipher.update(data, 'utf8'), cipher.final()]);
  return Buffer.from(encrypted).toString('base64');
}

function decrypt(data: string, ivKey: Buffer): string {
  const iv = ivKey.subarray(0, 16);
  const key = ivKey.subarray(16);
  const decipher = crypto.createDecipheriv('aes-128-cbc', key, iv);
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
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
    const response = await this.callServer<{ sessiontoken: string; regaintoken: string }>(query, this.loginSecret);

    this.sessionToken = response.sessiontoken;
    this.serverEncryptionToken = updateKey(this.loginSecret, this.sessionToken!);
    this.deviceEncryptionToken = updateKey(this.deviceSecret, this.sessionToken!);

    JDownloaderApiService.logger.log('Connected to MyJDownloader');
  }

  private async resolveDevice(): Promise<void> {
    const devices = await this.callServer<JDDevice[]>(
      `/my/listdevices?sessiontoken=${encodeURIComponent(this.sessionToken!)}`,
    );
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
    this.requestId = Date.now();
    return this.requestId;
  }

  private async callServer<T>(path: string, key?: Buffer): Promise<T> {
    const rid = this.nextRid();
    const encryptionKey = key ?? this.serverEncryptionToken!;
    const separator = path.includes('?') ? '&' : '?';
    const queryWithRid = `${path}${separator}rid=${rid}`;
    const signature = hmacSign(encryptionKey, queryWithRid);
    const url = `${JDownloaderApiService.BASE_URL}${queryWithRid}&signature=${signature}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/aesjson-jd; charset=utf-8' },
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.text();
    const decrypted = decrypt(data, encryptionKey);
    const result = JSON.parse(decrypted.replace(/[^\x20-\x7E]/g, ''));
    return result.list ?? result.data ?? result;
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
    const query = `/t_${encodeURIComponent(this.sessionToken!)}_${encodeURIComponent(this.deviceId!)}${action}`;

    const response = await fetch(`${JDownloaderApiService.BASE_URL}${query}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/aesjson-jd; charset=utf-8' },
      body: encrypted,
    });

    const responseText = await response.text();

    if (!response.ok) {
      let errorDetail = `HTTP ${response.status}`;
      try {
        errorDetail += `: ${decrypt(responseText, this.deviceEncryptionToken!)}`;
      } catch {
        errorDetail += `: ${responseText}`;
      }
      throw new Error(errorDetail);
    }

    const decrypted = decrypt(responseText, this.deviceEncryptionToken!);
    const result = JSON.parse(decrypted.replace(/[^\x20-\x7E]/g, ''));
    return result.data;
  }

  async disconnect(): Promise<void> {
    if (this.sessionToken) {
      try {
        await this.callServer(`/my/disconnect?sessiontoken=${encodeURIComponent(this.sessionToken)}`);
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
    this.serverEncryptionToken = null;
    this.deviceEncryptionToken = null;
    this.requestId = 0;
    await this.ensureConnected();
  }

  async queryPackages(): Promise<JDPackage[]> {
    const params = JSON.stringify({
      bytesLoaded: true,
      bytesTotal: true,
      finished: true,
      status: true,
      saveTo: true,
    });
    try {
      return await this.callDevice<JDPackage[]>('/downloadsV2/queryPackages', [params]);
    } catch (error) {
      JDownloaderApiService.logger.warn(
        `queryPackages failed, reconnecting: ${error instanceof Error ? error.message : error}`,
      );
      await this.reconnect();
      return this.callDevice<JDPackage[]>('/downloadsV2/queryPackages', [params]);
    }
  }

  async queryLinks(packageIds: number[]): Promise<JDLink[]> {
    const params = JSON.stringify({
      bytesLoaded: true,
      bytesTotal: true,
      finished: true,
      status: true,
      extractionStatus: true,
      packageUUIDs: packageIds,
    });
    return this.callDevice<JDLink[]>('/downloadsV2/queryLinks', [params]);
  }

  async cleanupPackages(packageIds: number[]): Promise<void> {
    const params = JSON.stringify({ packageIds });
    await this.callDevice('/downloadsV2/removePackages', [params]);
  }
}
