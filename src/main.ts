import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { WinstonModule } from 'nest-winston';

import { configureAppModule } from '@/app.module';
import { loadEnv } from '@/environment';
import { logger } from '@/services/logger';

(async () => {
  const env = loadEnv();

  const app = await NestFactory.create<NestExpressApplication>(configureAppModule(env), {
    logger: WinstonModule.createLogger({
      instance: logger,
    }),
  });

  await app.init();

  process.on('SIGINT', async () => {
    await app.close();
    process.exit(0);
  });

  await app.listen(7777);
})();
