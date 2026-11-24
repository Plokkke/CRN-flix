import { Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';

import { MetadataSource } from '@crn-flix/contracts';
import { JellyfinLayout } from '@crn-flix/layout-jellyfin';

import { Config } from '@/app.module';
import { METADATA } from '@/providers/media-titles';
import { SYNC_DATASOURCE } from '@/providers/syncDataSource';
import { DownloadJobsRepository } from '@/services/database/download-jobs';
import { ManualNumberingRepository } from '@/services/database/manual-numbering';
import { MediasRepository } from '@/services/database/medias';
import { RequestsRepository } from '@/services/database/requests';
import { TicketsRepository } from '@/services/database/tickets';
import { ParkedDownloads } from '@/services/downloads/parked';
import { LibraryPaths } from '@/services/library/paths';
import { LibraryShelves } from '@/services/library/shelves';
import { MediaIdentifierService } from '@/services/media-identifier';
import { MediaLabelizerService } from '@/services/media-labelizer';
import { PostDownloadPipeline } from '@/services/post-download-pipeline';
import { TicketService } from '@/services/tickets/ticket.service';

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
    const store = { ...mediaPaths, movies: paths.store('movies'), series: paths.store('series') };
    return new MediaLabelizerService(store, titles, new JellyfinLayout(), (title) => shelves.titlePlaced(title));
  },
};

export const parkedDownloadsProvider: Provider = {
  provide: ParkedDownloads,
  inject: [
    ConfigService,
    DownloadJobsRepository,
    ManualNumberingRepository,
    MediasRepository,
    MediaLabelizerService,
    TicketService,
  ],
  useFactory: (
    configService: ConfigService<Config, true>,
    jobs: DownloadJobsRepository,
    numbering: ManualNumberingRepository,
    medias: MediasRepository,
    placement: MediaLabelizerService,
    tickets: TicketService,
  ): ParkedDownloads =>
    new ParkedDownloads(jobs, numbering, medias, placement, tickets, configService.get('server').url),
};

export const postDownloadPipelineProvider: Provider = {
  provide: PostDownloadPipeline,
  inject: [DownloadJobsRepository, MediaIdentifierService, MediaLabelizerService, TicketsRepository, ParkedDownloads],
  useFactory: (
    downloadJobs: DownloadJobsRepository,
    identification: MediaIdentifierService,
    placement: MediaLabelizerService,
    tickets: TicketsRepository,
    parking: ParkedDownloads,
  ): PostDownloadPipeline => new PostDownloadPipeline(downloadJobs, identification, placement, tickets, parking),
};

export const postDownloadProviders: Provider[] = [
  identificationProvider,
  placementProvider,
  parkedDownloadsProvider,
  postDownloadPipelineProvider,
];
