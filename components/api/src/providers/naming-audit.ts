import { Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { Config } from '@/app.module';
import { JellyfinMediaService } from '@/modules/jellyfin/jellyfin';
import { TmdbApiService } from '@/modules/tmdb/tmdb';
import { NamingAuditRepository } from '@/services/database/naming-audit';
import { EnglishTitleResolver } from '@/services/english-title-resolver';
import { MediaLabelizerService } from '@/services/media-labelizer';
import { NamingAuditService } from '@/services/naming-audit';

export const englishTitleResolverProvider: Provider = {
  provide: EnglishTitleResolver,
  inject: [TmdbApiService],
  useFactory: (tmdb: TmdbApiService): EnglishTitleResolver => new EnglishTitleResolver(tmdb),
};

export const namingAuditProvider: Provider = {
  provide: NamingAuditService,
  inject: [ConfigService, JellyfinMediaService, MediaLabelizerService, EnglishTitleResolver, NamingAuditRepository],
  useFactory: (
    configService: ConfigService<Config, true>,
    jellyfin: JellyfinMediaService,
    labelizer: MediaLabelizerService,
    englishTitle: EnglishTitleResolver,
    auditRepo: NamingAuditRepository,
  ): NamingAuditService => {
    const config = configService.get('namingAudit');
    return new NamingAuditService(config, jellyfin, labelizer, englishTitle, auditRepo);
  },
};

export const namingAuditProviders: Provider[] = [englishTitleResolverProvider, namingAuditProvider];
