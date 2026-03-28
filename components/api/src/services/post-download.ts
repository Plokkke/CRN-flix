import * as fs from 'fs/promises';
import * as path from 'path';

import { Logger } from '@nestjs/common';

import { JDownloaderApiService, JDExtractionStatus, JDLink } from '@/modules/jdownloader/jdownloader-api.service';

import { DownloadJobEntity, DownloadJobsRepository, DownloadJobStatus } from './database/download-jobs';
import { MediaIdentifierService } from './media-identifier';
import { MediaLabelizerService } from './media-labelizer';

const VIDEO_EXTENSIONS = new Set(['.mkv', '.mp4', '.avi', '.m4v', '.wmv', '.flv', '.mov', '.webm']);

const EXTRACTION_POLL_INTERVAL_MS = 15_000;

export enum JDExtractionState {
  Done = 'done',
  Running = 'running',
  Error = 'error',
  None = 'none',
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class PostDownloadService {
  private static readonly logger = new Logger(PostDownloadService.name);

  constructor(
    private readonly jdownloader: JDownloaderApiService,
    private readonly downloadJobs: DownloadJobsRepository,
    private readonly identification: MediaIdentifierService,
    private readonly placement: MediaLabelizerService,
    private readonly downloadsPath: string,
    private readonly jdownloaderOutputPath: string,
  ) {}

  private toLocalPath(jdownloaderPath: string): string {
    if (jdownloaderPath.startsWith(this.jdownloaderOutputPath)) {
      return jdownloaderPath.replace(this.jdownloaderOutputPath, this.downloadsPath);
    }
    return jdownloaderPath;
  }

  async pullCompletedDownloads(): Promise<void> {
    const packages = await this.jdownloader.queryPackages();
    PostDownloadService.logger.debug(`JDownloader packages: ${JSON.stringify(packages)}`);

    const finishedPackages = packages.filter((p) => p.finished);
    PostDownloadService.logger.log(`Found ${finishedPackages.length}/${packages.length} finished packages`);

    for (const pkg of finishedPackages) {
      const localPath = this.toLocalPath(pkg.saveTo ?? this.jdownloaderOutputPath);
      PostDownloadService.logger.log(
        `Package "${pkg.name}" — saveTo: "${pkg.saveTo}" → local: "${localPath}" (jdOutput: "${this.jdownloaderOutputPath}", downloads: "${this.downloadsPath}")`,
      );
      await this.downloadJobs.create({
        jdownloaderPackageId: pkg.uuid,
        packageName: pkg.name,
        saveTo: localPath,
      });
    }
  }

  async processJob(jobId: string): Promise<void> {
    const job = await this.downloadJobs.get(jobId);
    if (!job || job.status !== DownloadJobStatus.Detected) {
      return;
    }

    PostDownloadService.logger.log(`Processing job ${job.id} — "${job.packageName}"`);

    let links: JDLink[];
    let state: JDExtractionState;

    while (true) {
      links = await this.jdownloader.queryLinks([job.jdownloaderPackageId]);
      PostDownloadService.logger.debug(`Job ${job.id} links: ${JSON.stringify(links)}`);
      state = this.resolveExtractionState(links);
      PostDownloadService.logger.log(`Job ${job.id} extraction state: ${state}`);
      if (state !== JDExtractionState.Running) {
        break;
      }
      await sleep(EXTRACTION_POLL_INTERVAL_MS);
    }

    if (state === JDExtractionState.Error) {
      return this.onExtractionError(job, links);
    }

    return this.onExtractionDone(job);
  }

  async cleanupPackage(packageId: number): Promise<void> {
    try {
      await this.jdownloader.cleanupPackages([packageId]);
      PostDownloadService.logger.debug(`Cleaned up JDownloader package ${packageId}`);
    } catch (error) {
      PostDownloadService.logger.warn(`Failed to cleanup JDownloader package: ${(error as Error).message}`);
    }
  }

  private async onExtractionError(job: DownloadJobEntity, links: JDLink[]): Promise<void> {
    const errorLinks = links.filter((l) => l.extractionStatus?.startsWith('ERROR'));
    const errors = errorLinks.map((l) => `${l.name}: ${l.extractionStatus}`).join(', ');
    PostDownloadService.logger.error(`Job ${job.id} extraction failed: ${errors}`);

    await this.downloadJobs.updateStatus(job.id, DownloadJobStatus.Failed, `JDownloader extraction failed: ${errors}`);
  }

  private async onExtractionDone(job: DownloadJobEntity): Promise<void> {
    job.sourcePaths = await this.resolveVideoFiles(job.saveTo);

    if (job.sourcePaths.length === 0) {
      PostDownloadService.logger.warn(`Job ${job.id} — no video files found in ${job.saveTo}`);
      await this.downloadJobs.updateStatus(job.id, DownloadJobStatus.Failed, `No video files found in ${job.saveTo}`);
      return;
    }

    await this.downloadJobs.updateSourcePaths(job.id, job.sourcePaths);
    PostDownloadService.logger.log(`Job ${job.id} — ${job.sourcePaths.length} video files found`);

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
      PostDownloadService.logger.log(`Job ${job.id} completed successfully`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      PostDownloadService.logger.error(`Job ${job.id} failed: ${message}`);
      await this.downloadJobs.updateStatus(job.id, DownloadJobStatus.Failed, message);
    }
  }

  private resolveExtractionState(links: JDLink[]): JDExtractionState {
    const statuses = links
      .map((l) => l.extractionStatus)
      .filter((s): s is JDExtractionStatus => s !== null && s !== undefined);

    if (statuses.length === 0) {
      return JDExtractionState.None;
    }

    if (statuses.some((s) => s === JDExtractionStatus.RUNNING)) {
      return JDExtractionState.Running;
    }

    if (statuses.some((s) => s.startsWith('ERROR'))) {
      return JDExtractionState.Error;
    }

    return JDExtractionState.Done;
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
      PostDownloadService.logger.warn(`Could not read directory: ${directory}`);
    }

    return videoFiles;
  }
}
