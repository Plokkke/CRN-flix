import { Logger } from '@nestjs/common';
import { CookieOptions } from 'express';

import { generateToken, sha256 } from '@/services/auth/otp';
import { SessionsRepository } from '@/services/database/sessions';

/** Browsers cap cookie lifetime at 400 days; the window slides on every use. */
export const SESSION_TTL_MS = 400 * 24 * 60 * 60 * 1000;
/** Avoid one write per request: only slide the window when the session is a day stale. */
const TOUCH_THRESHOLD_MS = 24 * 60 * 60 * 1000;

export type SessionAuthConfig = {
  /** Set when the service is served over HTTPS; a secure cookie is dropped over plain HTTP. */
  secureCookies: boolean;
  /** Scope of the cookie: the login area it protects. */
  cookiePath: string;
};

/**
 * Long-lived opaque session tokens bound to a cookie. Subclasses own the challenge that
 * proves identity before a session is opened.
 */
export abstract class SessionAuthService {
  protected abstract readonly logger: Logger;

  constructor(
    private readonly sessionConfig: SessionAuthConfig,
    private readonly sessions: SessionsRepository,
  ) {}

  /** SameSite=Lax is what keeps the area's POST endpoints safe from cross-site submissions. */
  get cookieOptions(): CookieOptions {
    return {
      httpOnly: true,
      secure: this.sessionConfig.secureCookies,
      sameSite: 'lax',
      path: this.sessionConfig.cookiePath,
      maxAge: SESSION_TTL_MS,
    };
  }

  async validateSession(token: string): Promise<{ subjectId: string } | null> {
    const session = await this.sessions.getLive(sha256(token));
    if (!session) {
      return null;
    }

    if (Date.now() - session.lastUsedAt.getTime() > TOUCH_THRESHOLD_MS) {
      await this.sessions.touch(session.id, new Date(Date.now() + SESSION_TTL_MS));
    }
    return { subjectId: session.subjectId };
  }

  async revokeSession(token: string): Promise<void> {
    await this.sessions.revoke(sha256(token));
  }

  protected async openSession(subjectId: string, userAgent: string | null): Promise<string> {
    const token = generateToken();
    await this.sessions.create({
      tokenHash: sha256(token),
      subjectId,
      userAgent,
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
    });
    this.logger.log(`Session opened for ${subjectId}`);
    return token;
  }
}
