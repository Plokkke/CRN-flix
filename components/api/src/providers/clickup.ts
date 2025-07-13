import { FactoryProvider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { Config } from '@/app.module';
import { ClickUpService } from '@/services/clickup';

export const clickupProvider: FactoryProvider<ClickUpService> = {
  provide: ClickUpService,
  inject: [ConfigService],
  useFactory: async (configService: ConfigService<Config, true>): Promise<ClickUpService> => {
    const config = configService.get<Config['clickup']>('clickup');
    return await ClickUpService.create(config);
  },
};
