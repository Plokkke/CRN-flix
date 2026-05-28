import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { WinstonModule } from 'nest-winston';

import { configureAppModule } from '@/app.module';
import { loadEnv } from '@/environment';
import { installShutdownHandlers } from '@/helpers/shutdown';
import { logger } from '@/services/logger';

(async () => {
  const env = loadEnv();

  const app = await NestFactory.create<NestExpressApplication>(configureAppModule(env), {
    logger: WinstonModule.createLogger({
      instance: logger,
    }),
  });

  app.enableShutdownHooks();
  installShutdownHandlers(app);

  await app.init();
  await app.listen(env.server.port);
})();
