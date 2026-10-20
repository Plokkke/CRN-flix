import { Controller, Get } from '@nestjs/common';

/** Liveness plus the deployed version, read by the deployer after each deployment. */
@Controller('health')
export class HealthVersionController {
  @Get()
  health(): { status: 'ok'; version: string } {
    return { status: 'ok', version: process.env.APP_VERSION ?? 'dev' };
  }
}
