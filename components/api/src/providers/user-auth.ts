import { Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { Config } from '@/app.module';
import { MemoryCacheService } from '@/services/cache/memory-cache.service';
import { UserSessionsRepository } from '@/services/database/user-sessions';
import { UsersRepository } from '@/services/database/users';
import { AllUserMessaging } from '@/services/messaging/user/all';
import { UserAuthService } from '@/services/user-auth';

export const userAuthProvider: Provider = {
  provide: UserAuthService,
  inject: [ConfigService, UserSessionsRepository, MemoryCacheService, UsersRepository, AllUserMessaging],
  useFactory: (
    configService: ConfigService<Config, true>,
    sessions: UserSessionsRepository,
    cache: MemoryCacheService,
    users: UsersRepository,
    messaging: AllUserMessaging,
  ): UserAuthService => {
    const serverConfig = configService.get<Config['server']>('server');

    return new UserAuthService(
      {
        serviceName: configService.get('name'),
        serverUrl: serverConfig.url,
        secureCookies: serverConfig.url.startsWith('https://'),
      },
      sessions,
      cache,
      users,
      messaging,
    );
  },
};
