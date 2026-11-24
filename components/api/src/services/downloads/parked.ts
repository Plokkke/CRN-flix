import * as fs from 'fs/promises';
import * as path from 'path';

import { Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';

import { Listener } from '@/helpers/events';
import {
  DownloadJobEntity,
  DownloadJobEvents,
  DownloadJobsRepository,
  DownloadJobStatus,
} from '@/services/database/download-jobs';
import { ManualNumberingRepository } from '@/services/database/manual-numbering';
import { MediasRepository } from '@/services/database/medias';
import { MediaIdentity, MediaLabelizerService } from '@/services/media-labelizer';
import { TicketCategory } from '@/services/tickets/model';
import { TicketService } from '@/services/tickets/ticket.service';

const SUBJECT_TYPE = 'download_job';

/** A file a parked job left in the download folder. `key` names it in the episodes form. */
export type PendingFile = { key: string; jobId: string; absolutePath: string; packageName: string };

export const PENDING_PREFIX = 'pending:';

const pendingKey = (jobId: string, absolutePath: string): string =>
  `${PENDING_PREFIX}${jobId}/${path.basename(absolutePath)}`;

const exists = (target: string): Promise<boolean> =>
  fs.access(target).then(
    () => true,
    () => false,
  );

/**
 * Downloads of a show numbered by hand (`manual_numbering`) are not placed: the pipeline parks
 * them, their files stay in the download folder under their release names, a ticket points the
 * admin to the show's episodes page, where placing a file goes through the usual placement.
 * A job whose files are all placed completes like any other (rescan, Fetchr removal).
 */
export class ParkedDownloads implements OnModuleInit, OnModuleDestroy {
  private static readonly logger = new Logger(ParkedDownloads.name);
  private listener: Listener<DownloadJobEvents> | null = null;

  constructor(
    private readonly jobs: DownloadJobsRepository,
    private readonly numbering: ManualNumberingRepository,
    private readonly medias: MediasRepository,
    private readonly placement: MediaLabelizerService,
    private readonly tickets: TicketService,
    private readonly serverUrl: string,
  ) {}

  onModuleInit(): void {
    this.listener = this.jobs.listen({
      statusChange: async ({ jobId, newStatus }) => {
        const job = await this.jobs.get(jobId);
        if (job && newStatus === DownloadJobStatus.AwaitingMapping) {
          await this.openTicket(job);
        } else if (job && newStatus === DownloadJobStatus.Completed) {
          await this.tickets.resolveBySubject(TicketCategory.EpisodeMapping, SUBJECT_TYPE, job.id, 'Fichiers classés');
        }
      },
    });
  }

  onModuleDestroy(): void {
    this.listener?.cleanup();
  }

  shouldPark(imdbId: string): Promise<boolean> {
    return this.numbering.isManual(imdbId);
  }

  pageUrl(imdbId: string): string {
    return `${this.serverUrl}/admin/library/${encodeURIComponent(imdbId)}/episodes`;
  }

  private async openTicket(job: DownloadJobEntity): Promise<void> {
    if (!job.mappingImdbId) {
      return;
    }
    const titles = await this.medias.displayTitlesOf([job.mappingImdbId]);
    const title = titles.get(job.mappingImdbId) ?? job.mappingImdbId;
    await this.tickets.open(
      TicketCategory.EpisodeMapping,
      { type: SUBJECT_TYPE, id: job.id },
      {
        jobId: job.id,
        imdbId: job.mappingImdbId,
        title,
        fileNames: job.sourcePaths.map((file) => path.basename(file)),
        pageUrl: this.pageUrl(job.mappingImdbId),
      },
      { title: `Épisodes à classer — ${title}` },
    );
  }

  /** Every file still waiting for the show, oldest download first. */
  async pending(imdbId: string): Promise<PendingFile[]> {
    const jobs = await this.jobs.listAwaitingMapping(imdbId);
    const files = await Promise.all(
      jobs.map(async (job) => {
        const present = await Promise.all(job.sourcePaths.map(exists));
        return job.sourcePaths
          .filter((_file, index) => present[index])
          .map((absolutePath) => ({
            key: pendingKey(job.id, absolutePath),
            jobId: job.id,
            absolutePath,
            packageName: job.packageName,
          }));
      }),
    );
    return files.flat();
  }

  /** Where a waiting file would land: what the collision check compares. */
  destinationOf(file: PendingFile, identity: MediaIdentity): Promise<string> {
    return this.placement.destinationOf(file.absolutePath, identity);
  }

  /** Places the files through the usual placement, then completes the jobs left without a file. */
  async place(placements: { file: PendingFile; identity: MediaIdentity }[]): Promise<void> {
    for (const { file, identity } of placements) {
      await this.placement.move(file.absolutePath, identity);
    }
    const jobIds = [...new Set(placements.map(({ file }) => file.jobId))];
    await Promise.all(jobIds.map((jobId) => this.settle(jobId)));
  }

  private async settle(jobId: string): Promise<void> {
    const job = await this.jobs.get(jobId);
    if (!job || job.status !== DownloadJobStatus.AwaitingMapping) {
      return;
    }
    const present = await Promise.all(job.sourcePaths.map(exists));
    const remaining = job.sourcePaths.filter((_file, index) => present[index]);
    if (remaining.length > 0) {
      await this.jobs.updateSourcePaths(job.id, remaining);
      return;
    }
    ParkedDownloads.logger.log(`Job ${job.id}: every parked file placed`);
    await this.jobs.updateStatus(job.id, DownloadJobStatus.Completed);
  }
}
