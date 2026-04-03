import * as fs from 'fs/promises';
import * as path from 'path';

import { Logger } from '@nestjs/common';

import { DownloadJobEntity, DownloadJobsRepository, DownloadJobStatus } from './database/download-jobs';
import { MediaIdentifierService } from './media-identifier';
import { MediaLabelizerService } from './media-labelizer';

const VIDEO_EXTENSIONS = new Set(['.mkv', '.mp4', '.avi', '.m4v', '.wmv', '.flv', '.mov', '.webm']);

export class PostDownloadPipeline {
  private static readonly logger = new Logger(PostDownloadPipeline.name);

  constructor(
    private readonly downloadJobs: DownloadJobsRepository,
    private readonly identification: MediaIdentifierService,
    private readonly placement: MediaLabelizerService,
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

    PostDownloadPipeline.logger.log(`Job ${job.id} — ${job.sourcePaths.length} video files to process`);
    await this.handleFiles(job);
  }

  private async handleFiles(job: DownloadJobEntity): Promise<void> {
    try {
      await this.downloadJobs.updateStatus(job.id, DownloadJobStatus.Identifying);

      for (const videoFile of job.sourcePaths) {
        const identity = await this.identification.identify(videoFile, job.id);
        if (!identity) {
          throw new Error(`Identification failed for ${path.basename(videoFile)}`);
        }

        await this.placement.move(videoFile, identity);
      }

      await this.downloadJobs.updateStatus(job.id, DownloadJobStatus.Completed);
      PostDownloadPipeline.logger.log(`Job ${job.id} completed successfully`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      PostDownloadPipeline.logger.error(`Job ${job.id} failed: ${message}`);
      await this.downloadJobs.updateStatus(job.id, DownloadJobStatus.Failed, message);
    }
  }

  async retryWithImdbId(jobId: string, imdbId: string): Promise<void> {
    const job = await this.downloadJobs.get(jobId);
    if (!job || job.status !== DownloadJobStatus.Failed) {
      return;
    }

    PostDownloadPipeline.logger.log(`Retrying job ${job.id} with IMDb ID ${imdbId}`);
    await this.downloadJobs.updateStatus(job.id, DownloadJobStatus.Identifying);

    try {
      for (const videoFile of job.sourcePaths) {
        const identity = await this.identification.identifyWithImdbId(videoFile, imdbId, job.id);
        if (!identity) {
          throw new Error(`Cannot identify ${path.basename(videoFile)} with IMDb ID ${imdbId}`);
        }

        await this.placement.move(videoFile, identity);
      }

      await this.downloadJobs.updateStatus(job.id, DownloadJobStatus.Completed);
      PostDownloadPipeline.logger.log(`Job ${job.id} retry completed successfully`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      PostDownloadPipeline.logger.error(`Job ${job.id} retry failed: ${message}`);
      await this.downloadJobs.updateStatus(job.id, DownloadJobStatus.Failed, message);
    }
  }

  private async resolveVideoFiles(directory: string): Promise<string[]> {
    const videoFiles: string[] = [];

    try {
      const entries = await fs.readdir(directory, { recursive: true, withFileTypes: true });
      for (const entry of entries) {
        if (entry.isFile() && VIDEO_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
          videoFiles.push(path.join(entry.parentPath, entry.name));
        }
      }
    } catch {
      PostDownloadPipeline.logger.warn(`Could not read directory: ${directory}`);
    }

    return videoFiles;
  }
}
