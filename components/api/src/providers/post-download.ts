import { Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';

import { MetadataSource } from '@crn-flix/contracts';
import { JellyfinLayout } from '@crn-flix/layout-jellyfin';

import { Config } from '@/app.module';
import { METADATA } from '@/providers/media-titles';
import { SYNC_DATASOURCE } from '@/providers/syncDataSource';
import { DownloadJobsRepository } from '@/services/database/download-jobs';
import { MediasRepository } from '@/services/database/medias';
import { RequestsRepository } from '@/services/database/requests';
import { TicketsRepository } from '@/services/database/tickets';
import { LibraryPaths } from '@/services/library/paths';
import { LibraryShelves } from '@/services/library/shelves';
import { MediaIdentifierService } from '@/services/media-identifier';
import { MediaLabelizerService } from '@/services/media-labelizer';
import { PostDownloadPipeline } from '@/services/post-download-pipeline';

export const identificationProvider: Provider = {
  provide: MediaIdentifierService,
  inject: [METADATA, SYNC_DATASOURCE, MediasRepository, RequestsRepository],
  useFactory: (
    metadata: MetadataSource,
    pool: Pool,
    medias: MediasRepository,
    requests: RequestsRepository,
  ): MediaIdentifierService => new MediaIdentifierService(metadata, pool, medias, requests),
};

/** With shelves, files go to the store and the shelves only link to them. */
export const placementProvider: Provider = {
  provide: MediaLabelizerService,
  inject: [ConfigService, METADATA, LibraryPaths, LibraryShelves],
  useFactory: (
    configService: ConfigService<Config, true>,
    titles: MetadataSource,
    paths: LibraryPaths,
    shelves: LibraryShelves,
  ): MediaLabelizerService => {
    const mediaPaths = configService.get('mediaPaths');
    if (configService.get('library').layout === 'legacy') {
      return new MediaLabelizerService(mediaPaths, titles, new JellyfinLayout());
    }
    const store = { ...mediaPaths, movies: paths.store('movies'), series: paths.store('series') };
    return new MediaLabelizerService(store, titles, new JellyfinLayout(), (title) => shelves.titlePlaced(title));
  },
};

export const postDownloadPipelineProvider: Provider = {
  provide: PostDownloadPipeline,
  inject: [DownloadJobsRepository, MediaIdentifierService, MediaLabelizerService, TicketsRepository],
  useFactory: (
    downloadJobs: DownloadJobsRepository,
    identification: MediaIdentifierService,
    placement: MediaLabelizerService,
    tickets: TicketsRepository,
  ): PostDownloadPipeline => new PostDownloadPipeline(downloadJobs, identification, placement, tickets),
};

export const postDownloadProviders: Provider[] = [
  identificationProvider,
  placementProvider,
  postDownloadPipelineProvider,
];
