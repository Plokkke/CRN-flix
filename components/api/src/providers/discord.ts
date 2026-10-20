import { FactoryProvider, Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { DiscordService } from '@crn-flix/discord';

import { Config } from '@/app.module';

/** The single bot connection every Discord plugin shares. */
export const discordProvider: FactoryProvider<DiscordService> = {
  provide: DiscordService,
  inject: [ConfigService],
  useFactory: (configService: ConfigService<Config, true>): Promise<DiscordService> =>
    DiscordService.create(configService.get<Config['discord']>('discord')),
};

/** The engine owns the shared connection, so it closes it. */
@Injectable()
export class DiscordConnectionLifecycle implements OnModuleDestroy {
  constructor(private readonly discord: DiscordService) {}

  onModuleDestroy(): Promise<void> {
    return this.discord.destroy();
  }
}
