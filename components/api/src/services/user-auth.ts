import { Logger } from '@nestjs/common';
import { CookieOptions } from 'express';

import {
  CODE_COOLDOWN_SECONDS,
  CODE_TTL_SECONDS,
  CodeRequestOutcome,
  generateCode,
  generateToken,
  matchesHash,
  MAX_CODE_ATTEMPTS,
  sha256,
} from '@/services/auth/otp';
import { SessionAuthService } from '@/services/auth/session-auth';
import { MemoryCacheService } from '@/services/cache/memory-cache.service';
import { UserSessionsRepository } from '@/services/database/user-sessions';
import { UserEntity, UsersRepository, UserStatus } from '@/services/database/users';
import { AllUserMessaging } from '@/services/messaging/user/all';

export type UserAuthConfig = {
  serviceName: string;
  /** Public base URL of the service, used to build the magic link. */
  serverUrl: string;
  secureCookies: boolean;
};

export const USER_SESSION_COOKIE = 'crn_user_session';
/** Short-lived cookie remembering which user is in the middle of a challenge. */
export const USER_LOGIN_COOKIE = 'crn_user_login';
export const USER_SPACE_PATH = '/me';
export const USER_LOGIN_LINK_PATH = `${USER_SPACE_PATH}/login/link`;
export const CHALLENGE_TTL_MINUTES = CODE_TTL_SECONDS / 60;

export type UserCodeRequestOutcome = CodeRequestOutcome | 'unknown-user';

/** A single challenge carries both proofs: a code to type and a token embedded in a link. */
type PendingChallenge = { codeHash: string; linkHash: string; attempts: number };

const pendingKey = (userId: string): string => `user-auth:pending:${userId}`;
const cooldownKey = (userId: string): string => `user-auth:cooldown:${userId}`;

export class UserAuthService extends SessionAuthService {
  protected readonly logger = new Logger(UserAuthService.name);

  constructor(
    private readonly config: UserAuthConfig,
    sessions: UserSessionsRepository,
    private readonly cache: MemoryCacheService,
    private readonly users: UsersRepository,
    private readonly messaging: AllUserMessaging,
  ) {
    super({ secureCookies: config.secureCookies, cookiePath: USER_SPACE_PATH }, sessions);
  }

  /** Remembers which user is mid-challenge, for as long as the challenge lives. */
  get loginCookieOptions(): CookieOptions {
    return { ...this.cookieOptions, maxAge: CODE_TTL_SECONDS * 1000 };
  }

  /** Sends a code + magic link through the user's own messaging channel (email or Discord). */
  async requestCode(username: string): Promise<{ outcome: UserCodeRequestOutcome; userId: string | null }> {
    const user = await this.users.getByName(username.trim());
    if (!user || user.status !== UserStatus.Active) {
      return { outcome: 'unknown-user', userId: null };
    }

    if (await this.cache.exists(cooldownKey(user.id))) {
      return { outcome: 'throttled', userId: user.id };
    }
    await this.cache.set(cooldownKey(user.id), true, CODE_COOLDOWN_SECONDS);

    const challenge = await this.deliverChallenge(user);
    if (!challenge) {
      return { outcome: 'delivery-failed', userId: user.id };
    }

    await this.cache.set<PendingChallenge>(pendingKey(user.id), challenge, CODE_TTL_SECONDS);
    this.logger.log(`Login challenge sent to user ${user.id} via ${user.messagingKey}`);
    return { outcome: 'sent', userId: user.id };
  }

  async verifyCode(userId: string, code: string, userAgent: string | null): Promise<string | null> {
    return this.verify(userId, code.trim(), 'codeHash', userAgent);
  }

  async verifyLink(userId: string, linkToken: string, userAgent: string | null): Promise<string | null> {
    return this.verify(userId, linkToken, 'linkHash', userAgent);
  }

  private async verify(
    userId: string,
    proof: string,
    hashField: 'codeHash' | 'linkHash',
    userAgent: string | null,
  ): Promise<string | null> {
    const pending = await this.cache.get<PendingChallenge>(pendingKey(userId));
    if (!pending || proof.length === 0) {
      return null;
    }

    if (!matchesHash(proof, pending[hashField])) {
      await this.registerFailedAttempt(userId, pending);
      return null;
    }

    await this.cache.del(pendingKey(userId));
    return this.openSession(userId, userAgent);
  }

  private async deliverChallenge(user: UserEntity): Promise<PendingChallenge | null> {
    const code = generateCode();
    const linkToken = generateToken();
    const link = `${this.config.serverUrl}${USER_LOGIN_LINK_PATH}?u=${user.id}&t=${linkToken}`;

    try {
      await this.messaging.loginChallenge(
        { key: user.messagingKey, id: user.messagingId },
        { code, link, serviceName: this.config.serviceName, expiresInMinutes: CHALLENGE_TTL_MINUTES },
      );
    } catch (error) {
      this.logger.error(`Failed to deliver a login challenge to user ${user.id}`, error);
      return null;
    }
    return { codeHash: sha256(code), linkHash: sha256(linkToken), attempts: 0 };
  }

  private async registerFailedAttempt(userId: string, pending: PendingChallenge): Promise<void> {
    const attempts = pending.attempts + 1;
    if (attempts >= MAX_CODE_ATTEMPTS) {
      this.logger.warn(`Login challenge of user ${userId} invalidated after too many failed attempts`);
      await this.cache.del(pendingKey(userId));
      return;
    }
    await this.cache.set<PendingChallenge>(pendingKey(userId), { ...pending, attempts }, CODE_TTL_SECONDS);
  }
}
