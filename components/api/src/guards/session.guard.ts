import { CanActivate, ExecutionContext, HttpException, HttpStatus, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';

import { readCookie } from '@/helpers/cookies';
import { SessionAuthService } from '@/services/auth/session-auth';

const SKIP_SESSION_AUTH = 'skipSessionAuth';

/** Marks a route as reachable without a session (the login flow itself). */
export const SkipSessionAuth = (): MethodDecorator & ClassDecorator => SetMetadata(SKIP_SESSION_AUTH, true);

/** Thrown when no valid session cookie is present; the filter turns it into a redirect. */
export class SessionAuthRequiredException extends HttpException {
  constructor(readonly loginPath: string) {
    super('Session required', HttpStatus.UNAUTHORIZED);
  }
}

export type SessionGuardOptions = {
  cookieName: string;
  loginPath: string;
  /** Request property receiving the authenticated subject id. */
  requestKey: string;
};

/** Cookie-session guard shared by every login area; subclasses bind it to their auth service. */
export abstract class SessionGuard implements CanActivate {
  protected abstract readonly options: SessionGuardOptions;

  constructor(
    private readonly auth: SessionAuthService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const skip = this.reflector.getAllAndOverride<boolean>(SKIP_SESSION_AUTH, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (skip) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const token = readCookie(request.headers.cookie, this.options.cookieName);
    const identity = token ? await this.auth.validateSession(token) : null;
    if (!identity) {
      throw new SessionAuthRequiredException(this.options.loginPath);
    }
    (request as Request & Record<string, unknown>)[this.options.requestKey] = identity.subjectId;
    return true;
  }
}
