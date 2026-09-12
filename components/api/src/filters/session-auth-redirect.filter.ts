import { ArgumentsHost, Catch, ExceptionFilter } from '@nestjs/common';
import { Response } from 'express';

import { SessionAuthRequiredException } from '@/guards/session.guard';

/** Sends browsers to the area's login page instead of a bare 401 payload. */
@Catch(SessionAuthRequiredException)
export class SessionAuthRedirectFilter implements ExceptionFilter {
  catch(exception: SessionAuthRequiredException, host: ArgumentsHost): void {
    host.switchToHttp().getResponse<Response>().redirect(exception.loginPath);
  }
}
