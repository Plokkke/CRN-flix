import { Logger } from '@nestjs/common';
import { z } from 'zod';

import { DiscordService } from '@/modules/discord/discord';
import {
  CODE_COOLDOWN_SECONDS,
  CODE_TTL_SECONDS,
  CodeRequestOutcome,
  generateCode,
  matchesHash,
  MAX_CODE_ATTEMPTS,
  sha256,
} from '@/services/auth/otp';
import { SessionAuthService } from '@/services/auth/session-auth';
import { MemoryCacheService } from '@/services/cache/memory-cache.service';
import { AdminSessionsRepository } from '@/services/database/admin-sessions';

export { CodeRequestOutcome } from '@/services/auth/otp';
export { SESSION_TTL_MS } from '@/services/auth/session-auth';

export const adminAuthConfigSchema = z.object({
  adminIds: z.array(z.string().min(1)).min(1),
  serviceName: z.string(),
  /** Set when the service is served over HTTPS; a secure cookie is dropped over plain HTTP. */
  secureCookies: z.boolean(),
});

export type AdminAuthConfig = z.infer<typeof adminAuthConfigSchema>;

export const ADMIN_SESSION_COOKIE = 'crn_admin_session';

const PENDING_CODE_KEY = 'admin-auth:pending-code';
const COOLDOWN_KEY = 'admin-auth:cooldown';

type IssuedCode = { adminId: string; codeHash: string };
type PendingCode = { codes: IssuedCode[]; attempts: number };

export class AdminAuthService extends SessionAuthService {
  protected readonly logger = new Logger(AdminAuthService.name);

  constructor(
    private readonly config: AdminAuthConfig,
    sessions: AdminSessionsRepository,
    private readonly cache: MemoryCacheService,
    private readonly discord: DiscordService,
  ) {
    super({ secureCookies: config.secureCookies, cookiePath: '/admin' }, sessions);
  }

  /** Generates a one-time code per admin and DMs it. Codes are only retained once delivered. */
  async requestCode(): Promise<CodeRequestOutcome> {
    if (await this.cache.exists(COOLDOWN_KEY)) {
      return 'throttled';
    }
    await this.cache.set(COOLDOWN_KEY, true, CODE_COOLDOWN_SECONDS);

    const codes = await this.deliverCodes();
    if (codes.length === 0) {
      this.logger.error('Failed to deliver an admin login code to any admin');
      return 'delivery-failed';
    }

    await this.cache.set<PendingCode>(PENDING_CODE_KEY, { codes, attempts: 0 }, CODE_TTL_SECONDS);
    this.logger.log(`Admin login code sent to ${codes.length}/${this.config.adminIds.length} admin(s)`);
    return 'sent';
  }

  /** Verifies a code and, on success, issues an opaque session token. */
  async verifyCode(code: string, userAgent: string | null): Promise<string | null> {
    const pending = await this.cache.get<PendingCode>(PENDING_CODE_KEY);
    if (!pending) {
      return null;
    }

    const issued = pending.codes.find((entry) => matchesHash(code.trim(), entry.codeHash));
    if (!issued) {
      await this.registerFailedAttempt(pending);
      return null;
    }

    await this.cache.del(PENDING_CODE_KEY);
    return this.openSession(issued.adminId, userAgent);
  }

  private async deliverCodes(): Promise<IssuedCode[]> {
    const deliveries = await Promise.allSettled(
      this.config.adminIds.map(async (adminId): Promise<IssuedCode> => {
        const code = generateCode();
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
      this.logger.warn('Admin login code invalidated after too many failed attempts');
      await this.cache.del(PENDING_CODE_KEY);
      return;
    }
    await this.cache.set<PendingCode>(PENDING_CODE_KEY, { ...pending, attempts }, CODE_TTL_SECONDS);
  }
}
