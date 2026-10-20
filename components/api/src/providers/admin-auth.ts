import { Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { AdminChannel } from '@crn-flix/contracts';

import { Config } from '@/app.module';
import { ADMIN_CHANNEL } from '@/providers/messaging/admin';
import { AdminAuthService } from '@/services/admin-auth';
import { MemoryCacheService } from '@/services/cache/memory-cache.service';
import { AdminSessionsRepository } from '@/services/database/admin-sessions';

export const adminAuthProvider: Provider = {
  provide: AdminAuthService,
  inject: [ConfigService, AdminSessionsRepository, MemoryCacheService, ADMIN_CHANNEL],
  useFactory: (
    configService: ConfigService<Config, true>,
    sessions: AdminSessionsRepository,
    cache: MemoryCacheService,
    adminChannel: AdminChannel,
  ): AdminAuthService => {
    const serverConfig = configService.get<Config['server']>('server');
    const administration = configService.get<Config['administration']>('administration');

    return new AdminAuthService(
      {
        adminIds: administration.adminIds,
        serviceName: configService.get('name'),
        secureCookies: serverConfig.url.startsWith('https://'),
      },
      sessions,
      cache,
      adminChannel,
    );
  },
};
