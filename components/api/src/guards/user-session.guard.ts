import { Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { SessionGuard, SessionGuardOptions } from '@/guards/session.guard';
import { USER_SESSION_COOKIE, USER_SPACE_PATH, UserAuthService } from '@/services/user-auth';

export const USER_REQUEST_KEY = 'userId';

/** Sets `request.userId` to the subscriber's users.id. */
@Injectable()
export class UserSessionGuard extends SessionGuard {
  protected readonly options: SessionGuardOptions = {
    cookieName: USER_SESSION_COOKIE,
    loginPath: `${USER_SPACE_PATH}/login`,
    requestKey: USER_REQUEST_KEY,
  };

  constructor(userAuth: UserAuthService, reflector: Reflector) {
    super(userAuth, reflector);
  }
}
