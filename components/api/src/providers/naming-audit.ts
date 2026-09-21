import { Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { Config } from '@/app.module';
import { JellyfinMediaService } from '@/modules/jellyfin/jellyfin';
import { NamingAuditRepository } from '@/services/database/naming-audit';
import { MediaLabelizerService } from '@/services/media-labelizer';
import { MediaTitlesResolver } from '@/services/media-titles-resolver';
import { NamingAuditService } from '@/services/naming-audit';

export const namingAuditProvider: Provider = {
  provide: NamingAuditService,
  inject: [ConfigService, JellyfinMediaService, MediaLabelizerService, MediaTitlesResolver, NamingAuditRepository],
  useFactory: (
    configService: ConfigService<Config, true>,
    jellyfin: JellyfinMediaService,
    labelizer: MediaLabelizerService,
    titles: MediaTitlesResolver,
    auditRepo: NamingAuditRepository,
  ): NamingAuditService => {
    const config = configService.get('namingAudit');
    return new NamingAuditService(config, jellyfin, labelizer, titles, auditRepo);
  },
};

export const namingAuditProviders: Provider[] = [namingAuditProvider];
