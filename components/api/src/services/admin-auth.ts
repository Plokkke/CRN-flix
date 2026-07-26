import * as crypto from 'crypto';

import { Logger } from '@nestjs/common';
import { CookieOptions } from 'express';
import { z } from 'zod';

import { DiscordService } from '@/modules/discord/discord';
import { MemoryCacheService } from '@/services/cache/memory-cache.service';
import { AdminSessionsRepository } from '@/services/database/admin-sessions';

export const adminAuthConfigSchema = z.object({
  adminIds: z.array(z.string().min(1)).min(1),
  serviceName: z.string(),
  /** Set when the service is served over HTTPS; a secure cookie is dropped over plain HTTP. */
  secureCookies: z.boolean(),
});

export type AdminAuthConfig = z.infer<typeof adminAuthConfigSchema>;

export const ADMIN_SESSION_COOKIE = 'crn_admin_session';

const CODE_TTL_SECONDS = 10 * 60;
const CODE_COOLDOWN_SECONDS = 30;
const MAX_CODE_ATTEMPTS = 5;
/** Browsers cap cookie lifetime at 400 days; the window slides on every use. */
export const SESSION_TTL_MS = 400 * 24 * 60 * 60 * 1000;
/** Avoid one write per request: only slide the window when the session is a day stale. */
const TOUCH_THRESHOLD_MS = 24 * 60 * 60 * 1000;

const PENDING_CODE_KEY = 'admin-auth:pending-code';
const COOLDOWN_KEY = 'admin-auth:cooldown';

export type CodeRequestOutcome = 'sent' | 'throttled' | 'delivery-failed';

type IssuedCode = { adminId: string; codeHash: string };
type PendingCode = { codes: IssuedCode[]; attempts: number };

function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function matches(candidate: string, expectedHash: string): boolean {
  const candidateHash = Buffer.from(sha256(candidate), 'hex');
  const expected = Buffer.from(expectedHash, 'hex');
  return candidateHash.length === expected.length && crypto.timingSafeEqual(candidateHash, expected);
}

export class AdminAuthService {
  private static readonly logger = new Logger(AdminAuthService.name);

  constructor(
    private readonly config: AdminAuthConfig,
    private readonly sessions: AdminSessionsRepository,
    private readonly cache: MemoryCacheService,
    private readonly discord: DiscordService,
  ) {}

  /** SameSite=Lax is what keeps the dashboard's POST endpoints safe from cross-site submissions. */
  get cookieOptions(): CookieOptions {
    return {
      httpOnly: true,
      secure: this.config.secureCookies,
      sameSite: 'lax',
      path: '/admin',
      maxAge: SESSION_TTL_MS,
    };
  }

  /** Generates a one-time code per admin and DMs it. Codes are only retained once delivered. */
  async requestCode(): Promise<CodeRequestOutcome> {
    if (await this.cache.exists(COOLDOWN_KEY)) {
      return 'throttled';
    }
    await this.cache.set(COOLDOWN_KEY, true, CODE_COOLDOWN_SECONDS);

    const codes = await this.deliverCodes();
    if (codes.length === 0) {
      AdminAuthService.logger.error('Failed to deliver an admin login code to any admin');
      return 'delivery-failed';
    }

    await this.cache.set<PendingCode>(PENDING_CODE_KEY, { codes, attempts: 0 }, CODE_TTL_SECONDS);
    AdminAuthService.logger.log(`Admin login code sent to ${codes.length}/${this.config.adminIds.length} admin(s)`);
    return 'sent';
  }

  /** Verifies a code and, on success, issues an opaque session token. */
  async verifyCode(code: string, userAgent: string | null): Promise<string | null> {
    const pending = await this.cache.get<PendingCode>(PENDING_CODE_KEY);
    if (!pending) {
      return null;
    }

    const issued = pending.codes.find((entry) => matches(code.trim(), entry.codeHash));
    if (!issued) {
      await this.registerFailedAttempt(pending);
      return null;
    }

    await this.cache.del(PENDING_CODE_KEY);
    return this.openSession(issued.adminId, userAgent);
  }

  async validateSession(token: string): Promise<boolean> {
    const session = await this.sessions.getLive(sha256(token));
    if (!session) {
      return false;
    }

    if (Date.now() - session.lastUsedAt.getTime() > TOUCH_THRESHOLD_MS) {
      await this.sessions.touch(session.id, new Date(Date.now() + SESSION_TTL_MS));
    }
    return true;
  }

  async revokeSession(token: string): Promise<void> {
    await this.sessions.revoke(sha256(token));
  }

  private async deliverCodes(): Promise<IssuedCode[]> {
    const deliveries = await Promise.allSettled(
      this.config.adminIds.map(async (adminId): Promise<IssuedCode> => {
        const code = crypto.randomInt(0, 1_000_000).toString().padStart(6, '0');
        await this.discord.sendDirectMessage(
          adminId,
          `Code de connexion ${this.config.serviceName} : **${code}**\nValable 10 minutes.`,
        );
        return { adminId, codeHash: sha256(code) };
      }),
    );
    return deliveries.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : []));
  }

  private async registerFailedAttempt(pending: PendingCode): Promise<void> {
    const attempts = pending.attempts + 1;
    if (attempts >= MAX_CODE_ATTEMPTS) {
      AdminAuthService.logger.warn('Admin login code invalidated after too many failed attempts');
      await this.cache.del(PENDING_CODE_KEY);
      return;
    }
    await this.cache.set<PendingCode>(PENDING_CODE_KEY, { ...pending, attempts }, CODE_TTL_SECONDS);
  }

  private async openSession(adminId: string, userAgent: string | null): Promise<string> {
    const token = crypto.randomBytes(32).toString('base64url');
    await this.sessions.create({
      tokenHash: sha256(token),
      discordUserId: adminId,
      userAgent,
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
    });
    AdminAuthService.logger.log(`Admin session opened for admin ${adminId}`);
    return token;
  }
}
