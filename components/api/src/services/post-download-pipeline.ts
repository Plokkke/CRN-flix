import * as fs from 'fs/promises';
import * as path from 'path';

import { Logger } from '@nestjs/common';

import { DownloadJobEntity, DownloadJobsRepository, DownloadJobStatus } from './database/download-jobs';
import { TicketsRepository } from './database/tickets';
import { IdentificationResult, MediaIdentifierService } from './media-identifier';
import { MediaLabelizerService } from './media-labelizer';
import { TICKET_ID_METADATA_KEY, TicketCategory, TicketPayloadMap } from './tickets/model';
import { isVideoFile } from './video-files';

type Identify = (videoFile: string) => Promise<IdentificationResult | null>;

const fileExists = (filePath: string): Promise<boolean> =>
  fs.access(filePath).then(
    () => true,
    () => false,
  );

const describeError = (error: unknown): string => (error instanceof Error ? error.message : String(error));

export class PostDownloadPipeline {
  private static readonly logger = new Logger(PostDownloadPipeline.name);

  constructor(
    private readonly downloadJobs: DownloadJobsRepository,
    private readonly identification: MediaIdentifierService,
    private readonly placement: MediaLabelizerService,
    private readonly tickets: TicketsRepository,
    private readonly exists: (filePath: string) => Promise<boolean> = fileExists,
  ) {}

  async processJob(jobId: string): Promise<void> {
    const job = await this.downloadJobs.get(jobId);
    if (!job || job.status !== DownloadJobStatus.Detected) {
      return;
    }

    PostDownloadPipeline.logger.log(`Processing job ${job.id} — "${job.packageName}"`);

    if (job.sourcePaths.length === 0) {
      job.sourcePaths = await this.resolveVideoFiles(job.saveTo);
      if (job.sourcePaths.length === 0) {
        PostDownloadPipeline.logger.warn(`Job ${job.id} — no video files found in ${job.saveTo}`);
        await this.downloadJobs.updateStatus(job.id, DownloadJobStatus.Failed, `No video files found in ${job.saveTo}`);
        return;
      }
      await this.downloadJobs.updateSourcePaths(job.id, job.sourcePaths);
    }

    await this.placeAll(job, (videoFile) => this.resolveIdentity(videoFile, job));
  }

  async retryWithImdbId(jobId: string, imdbId: string): Promise<void> {
    const job = await this.downloadJobs.get(jobId);
    if (!job || job.status !== DownloadJobStatus.Failed) {
      return;
    }

    PostDownloadPipeline.logger.log(`Retrying job ${job.id} with IMDb ID ${imdbId}`);
    await this.placeAll(job, (videoFile) => this.identification.identifyWithImdbId(videoFile, imdbId, job.id));
  }

  /**
   * Places every video still waiting in the download folder. A file already placed by an earlier
   * attempt is gone from it and simply skipped, so a retry resumes where the last one stopped.
   * On failure, the job keeps only the files left to place: that is what the ticket shows.
   */
  private async placeAll(job: DownloadJobEntity, identify: Identify): Promise<void> {
    await this.downloadJobs.updateStatus(job.id, DownloadJobStatus.Identifying);
    const pending = await this.pendingVideos(job);
    PostDownloadPipeline.logger.log(`Job ${job.id} — ${pending.length} video file(s) to place`);

    for (const [index, videoFile] of pending.entries()) {
      try {
        const identity = await identify(videoFile);
        if (!identity) {
          throw new Error(`Identification failed for ${path.basename(videoFile)}`);
        }
        await this.placement.move(videoFile, identity, job.metadata);
      } catch (error) {
        await this.fail(job, pending.slice(index), describeError(error));
        return;
      }
    }

    await this.downloadJobs.updateStatus(job.id, DownloadJobStatus.Completed);
    PostDownloadPipeline.logger.log(`Job ${job.id} completed successfully`);
  }

  private async pendingVideos(job: DownloadJobEntity): Promise<string[]> {
    const videos = job.sourcePaths.filter(isVideoFile);
    const present = await Promise.all(videos.map((videoFile) => this.exists(videoFile)));
    return videos.filter((_videoFile, index) => present[index]);
  }

  private async fail(job: DownloadJobEntity, remaining: string[], message: string): Promise<void> {
    PostDownloadPipeline.logger.error(`Job ${job.id} failed (${remaining.length} file(s) left): ${message}`);
    await this.downloadJobs.updateSourcePaths(job.id, remaining);
    await this.downloadJobs.updateStatus(job.id, DownloadJobStatus.Failed, message);
  }

  private async resolveIdentity(videoFile: string, job: DownloadJobEntity): Promise<IdentificationResult | null> {
    const requestId = (await this.ticketRequestId(job)) ?? job.metadata?.['crn-flix-request-id'];
    if (requestId) {
      PostDownloadPipeline.logger.log(`Job ${job.id} — resolving via metadata request ID: ${requestId}`);
      const identity = await this.identification.identifyFromRequest(videoFile, requestId, job.id);
      if (identity) {
        return identity;
      }
    }

    const imdbId = job.metadata?.imdbid;
    if (imdbId) {
      PostDownloadPipeline.logger.log(`Job ${job.id} — resolving via metadata IMDb ID: ${imdbId}`);
      const identity = await this.identification.identifyWithImdbId(videoFile, imdbId, job.id);
      if (identity) {
        return identity;
      }
    }

    PostDownloadPipeline.logger.log(`Job ${job.id} — resolving via filename identification`);
    return this.identification.identify(videoFile, job.id);
  }

  /** Metadata is frozen when Fetchr registers the download; the ticket carries later corrections. */
  private async ticketRequestId(job: DownloadJobEntity): Promise<string | undefined> {
    const ticketId = job.metadata?.[TICKET_ID_METADATA_KEY];
    if (!ticketId) {
      return undefined;
    }
    const ticket = await this.tickets.get(ticketId);
    if (ticket?.category !== TicketCategory.ManualDownload) {
      return undefined;
    }
    return (ticket.payload as TicketPayloadMap[TicketCategory.ManualDownload]).requestId;
  }

  private async resolveVideoFiles(directory: string): Promise<string[]> {
    try {
      const entries = await fs.readdir(directory, { recursive: true, withFileTypes: true });
      return entries
        .filter((entry) => entry.isFile() && isVideoFile(entry.name))
        .map((entry) => path.join(entry.parentPath, entry.name));
    } catch {
      PostDownloadPipeline.logger.warn(`Could not read directory: ${directory}`);
      return [];
    }
  }
}
