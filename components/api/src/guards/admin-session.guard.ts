import { Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { SessionGuard, SessionGuardOptions } from '@/guards/session.guard';
import { ADMIN_SESSION_COOKIE, AdminAuthService } from '@/services/admin-auth';

export { SkipSessionAuth as SkipAdminAuth } from '@/guards/session.guard';

/** Sets `request.adminUserId` to the admin's Discord id. */
@Injectable()
export class AdminSessionGuard extends SessionGuard {
  protected readonly options: SessionGuardOptions = {
    cookieName: ADMIN_SESSION_COOKIE,
    loginPath: '/admin/login',
    requestKey: 'adminUserId',
  };

  constructor(adminAuth: AdminAuthService, reflector: Reflector) {
    super(adminAuth, reflector);
  }
}
