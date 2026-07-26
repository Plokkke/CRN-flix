import { ArgumentsHost, Catch, ExceptionFilter } from '@nestjs/common';
import { Response } from 'express';

import { AdminAuthRequiredException } from '@/guards/admin-session.guard';

/** Sends browsers to the login page instead of a bare 401 payload. */
@Catch(AdminAuthRequiredException)
export class AdminAuthRedirectFilter implements ExceptionFilter {
  catch(_exception: AdminAuthRequiredException, host: ArgumentsHost): void {
    host.switchToHttp().getResponse<Response>().redirect('/admin/login');
  }
}
