import { Controller, Get } from '@nestjs/common';

import { appVersion } from '@/helpers/version';

/** Liveness plus the deployed version, read by the deployer after each deployment. */
@Controller('health')
export class HealthVersionController {
  @Get()
  health(): { status: 'ok'; version: string } {
    return { status: 'ok', version: appVersion() };
  }
}
