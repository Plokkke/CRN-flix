import * as fs from 'fs/promises';
import * as path from 'path';

import { Logger } from '@nestjs/common';
import { z } from 'zod';

import { LibraryLayout, LibrarySection, MetadataSource } from '@crn-flix/contracts';

import { IdentificationResult } from './media-identifier';

export type MediaIdentity = Pick<
  IdentificationResult,
  'title' | 'year' | 'imdbId' | 'mediaType' | 'seasonNumber' | 'episodeNumber' | 'episodeNumberEnd'
>;

export const mediaPathsConfigSchema = z.object({
  downloads: z.string(),
  movies: z.string(),
  series: z.string(),
});

export type MediaPathsConfig = z.infer<typeof mediaPathsConfigSchema>;

export type PlacementResult = {
  destinationPath: string;
};

export class MediaLabelizerService {
  private static readonly logger = new Logger(MediaLabelizerService.name);

  constructor(
    private readonly config: MediaPathsConfig,
    private readonly titles: MetadataSource,
    private readonly layout: LibraryLayout,
  ) {}

  async toCanonicalIdentity<T extends MediaIdentity>(identity: T): Promise<T> {
    if (!identity.imdbId) {
      return identity;
    }
    const resolution = await this.titles.describe(identity.imdbId);
    return resolution.title ? { ...identity, title: resolution.title } : identity;
  }

  /** The layout names the file; the engine picks the section root on its own volume. */
  generateDestination(identity: MediaIdentity): [string, string] {
    const { mediaType, ...rest } = identity;
    const { section, folders, fileName } = this.layout.place({ ...rest, type: mediaType });
    return [path.join(this.rootOf(section), ...folders), fileName];
  }

  private rootOf(section: LibrarySection): string {
    return section === 'series' ? this.config.series : this.config.movies;
  }

  async move(sourcePath: string, identity: IdentificationResult): Promise<void> {
    const canonical = await this.toCanonicalIdentity(identity);
    const [folderName, fileName] = this.generateDestination(canonical);
    const ext = path.extname(sourcePath);
    const destinationPath = path.join(folderName, `${fileName + ext}`);

    MediaLabelizerService.logger.log(`Moving "${path.basename(sourcePath)}" → "${destinationPath}"`);
    await fs.mkdir(folderName, { recursive: true });

    try {
      await fs.rename(sourcePath, destinationPath);
      MediaLabelizerService.logger.log(`Renamed successfully`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EXDEV') {
        MediaLabelizerService.logger.log(
          `Cross-device move, copying ${sourcePath} (this may take a while for large files)`,
        );
        try {
          await fs.copyFile(sourcePath, destinationPath);
        } catch (copyErr) {
          await fs.unlink(destinationPath).catch(() => {});
          throw copyErr;
        }
        MediaLabelizerService.logger.log(`Copy complete, removing source`);
        await fs.unlink(sourcePath);
      } else {
        MediaLabelizerService.logger.error(`Move failed: ${(error as Error).message}`);
        throw error;
      }
    }

    await this.cleanupEmptyParents(path.dirname(sourcePath), this.config.downloads);
    MediaLabelizerService.logger.log(`Placed: ${path.basename(sourcePath)} → ${destinationPath}`);
  }

  private async cleanupEmptyParents(dir: string, stopAt: string): Promise<void> {
    if (dir === stopAt || dir === path.dirname(dir)) {
      return;
    }

    try {
      const entries = await fs.readdir(dir);
      if (entries.length === 0) {
        await fs.rmdir(dir);
        await this.cleanupEmptyParents(path.dirname(dir), stopAt);
      }
    } catch {
      // ignore errors during cleanup
    }
  }
}
