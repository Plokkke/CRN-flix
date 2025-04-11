import { Injectable, Logger } from '@nestjs/common';

interface CacheEntry<T> {
  value: T;
  expiresAt: number | null;
}

@Injectable()
export class MemoryCacheService {
  private static readonly logger = new Logger(MemoryCacheService.name);
  private cache: Map<string, CacheEntry<unknown>> = new Map();

  private getEntry<T = unknown>(key: string): CacheEntry<T> | null {
    const entry = this.cache.get(key);
    if (!entry || (entry.expiresAt !== null && entry.expiresAt < Date.now())) {
      this.cache.delete(key);
      return null;
    }
    return entry as CacheEntry<T>;
  }

  async get<T>(key: string): Promise<T | null> {
    const entry = this.getEntry<T>(key);
    return entry && entry.value;
  }

  async set<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    const expiresAt = ttlSeconds ? Date.now() + ttlSeconds * 1000 : null;
    this.cache.set(key, { value, expiresAt });
  }

  async del(key: string): Promise<void> {
    this.cache.delete(key);
  }

  async exists(key: string): Promise<boolean> {
    return this.getEntry(key) !== null;
  }

  async expire(key: string, ttlSeconds: number): Promise<void> {
    const entry = this.getEntry(key);
    if (!entry) {
      return;
    }
    entry.expiresAt = Date.now() + ttlSeconds * 1000;
  }

  async ttl(key: string): Promise<number> {
    const entry = this.cache.get(key);

    if (!entry || entry.expiresAt === null) {
      return -1;
    }

    return Math.ceil(entry.expiresAt - Date.now());
  }

  async flush(): Promise<void> {
    this.cache.clear();
  }

  async withCache<T>(key: string, fn: () => Promise<T>, ttlSeconds?: number): Promise<T> {
    const cachedValue = await this.get<T>(key);
    if (cachedValue) {
      return cachedValue;
    }
    const result = await fn();
    await this.set(key, result, ttlSeconds);
    return result;
  }
}
