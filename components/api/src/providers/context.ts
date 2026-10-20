import { ConfigService } from '@nestjs/config';

import { Player } from '@crn-flix/contracts';

import { Config } from '@/app.module';
import { PLAYER } from '@/providers/player';
import { ContextService } from '@/services/context';

export const contextProvider = {
  provide: ContextService,
  inject: [ConfigService, PLAYER],
  useFactory: (configService: ConfigService<Config, true>, player: Player): ContextService => {
    return new ContextService(configService, player);
  },
};
