import { CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';

import { readCookie } from '@/helpers/cookies';
import { ADMIN_SESSION_COOKIE, AdminAuthService } from '@/services/admin-auth';

const SKIP_ADMIN_AUTH = 'skipAdminAuth';

/** Marks a route as reachable without an admin session (the login flow itself). */
export const SkipAdminAuth = (): MethodDecorator & ClassDecorator => SetMetadata(SKIP_ADMIN_AUTH, true);

/** Thrown when no valid session cookie is present; the filter turns it into a redirect. */
export class AdminAuthRequiredException extends HttpException {
  constructor() {
    super('Admin session required', HttpStatus.UNAUTHORIZED);
  }
}

@Injectable()
export class AdminSessionGuard implements CanActivate {
  constructor(
    private readonly adminAuth: AdminAuthService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const skip = this.reflector.getAllAndOverride<boolean>(SKIP_ADMIN_AUTH, [context.getHandler(), context.getClass()]);
    if (skip) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const token = readCookie(request.headers.cookie, ADMIN_SESSION_COOKIE);
    if (!token || !(await this.adminAuth.validateSession(token))) {
      throw new AdminAuthRequiredException();
    }
    return true;
  }
}
