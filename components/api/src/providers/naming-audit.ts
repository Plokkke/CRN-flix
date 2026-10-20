import { Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { MetadataSource } from '@crn-flix/contracts';
import { JellyfinMediaService } from '@crn-flix/player-jellyfin';

import { Config } from '@/app.module';
import { METADATA } from '@/providers/media-titles';
import { NamingAuditRepository } from '@/services/database/naming-audit';
import { MediaLabelizerService } from '@/services/media-labelizer';
import { NamingAuditService } from '@/services/naming-audit';

export const namingAuditProvider: Provider = {
  provide: NamingAuditService,
  inject: [ConfigService, JellyfinMediaService, MediaLabelizerService, METADATA, NamingAuditRepository],
  useFactory: (
    configService: ConfigService<Config, true>,
    jellyfin: JellyfinMediaService,
    labelizer: MediaLabelizerService,
    titles: MetadataSource,
    auditRepo: NamingAuditRepository,
  ): NamingAuditService => {
    const config = configService.get('namingAudit');
    return new NamingAuditService(config, jellyfin, labelizer, titles, auditRepo);
  },
};

export const namingAuditProviders: Provider[] = [namingAuditProvider];
