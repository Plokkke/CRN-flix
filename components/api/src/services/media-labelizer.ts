import { constants } from 'fs';
import * as fs from 'fs/promises';
import * as path from 'path';

import { Logger } from '@nestjs/common';
import { z } from 'zod';

import { LibraryLayout, LibraryPlacement, LibrarySection, MetadataSource } from '@crn-flix/contracts';

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

/** The store folder a file was placed in (its title's top folder). */
export type PlacedTitle = { imdbId: string; section: LibrarySection; folder: string };

export type PlacementResult = {
  destinationPath: string;
};

/** The placement target is already a file: replacing it could lose a corrected or better copy. */
export class PlacementTakenError extends Error {
  constructor(readonly destinationPath: string) {
    super(`Destination already taken, nothing replaced: ${destinationPath}`);
    this.name = 'PlacementTakenError';
  }
}

const exists = (target: string): Promise<boolean> =>
  fs.access(target).then(
    () => true,
    () => false,
  );

export class MediaLabelizerService {
  private static readonly logger = new Logger(MediaLabelizerService.name);

  constructor(
    private readonly config: MediaPathsConfig,
    private readonly titles: MetadataSource,
    private readonly layout: LibraryLayout,
    private readonly onPlaced: (title: PlacedTitle) => Promise<void> = async () => {},
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
    const { section, folders, fileName } = this.placementOf(identity);
    return [path.join(this.rootOf(section), ...folders), fileName];
  }

  private placementOf(identity: MediaIdentity): LibraryPlacement {
    const { mediaType, ...rest } = identity;
    return this.layout.place({ ...rest, type: mediaType });
  }

  private rootOf(section: LibrarySection): string {
    return section === 'series' ? this.config.series : this.config.movies;
  }

  /** Never replaces a file: a target already taken fails the placement, the admin decides. */
  async move(sourcePath: string, identity: IdentificationResult): Promise<void> {
    const canonical = await this.toCanonicalIdentity(identity);
    const [folderName, fileName] = this.generateDestination(canonical);
    const destinationPath = path.join(folderName, `${fileName}${path.extname(sourcePath)}`);

    MediaLabelizerService.logger.log(`Moving "${path.basename(sourcePath)}" → "${destinationPath}"`);
    await fs.mkdir(folderName, { recursive: true });
    if (await exists(destinationPath)) {
      throw new PlacementTakenError(destinationPath);
    }
    await this.transfer(sourcePath, destinationPath);

    await this.cleanupEmptyParents(path.dirname(sourcePath), this.config.downloads);
    MediaLabelizerService.logger.log(`Placed: ${path.basename(sourcePath)} → ${destinationPath}`);
    await this.announcePlaced(canonical);
  }

  private async transfer(sourcePath: string, destinationPath: string): Promise<void> {
    try {
      await fs.rename(sourcePath, destinationPath);
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EXDEV') {
        MediaLabelizerService.logger.error(`Move failed: ${(error as Error).message}`);
        throw error;
      }
    }
    MediaLabelizerService.logger.log(
      `Cross-device move, copying ${sourcePath} (this may take a while for large files)`,
    );
    try {
      await fs.copyFile(sourcePath, destinationPath, constants.COPYFILE_EXCL);
    } catch (copyErr) {
      if ((copyErr as NodeJS.ErrnoException).code !== 'EEXIST') {
        await fs.unlink(destinationPath).catch(() => {});
      }
      throw copyErr;
    }
    await fs.unlink(sourcePath);
  }

  /** The file is in place whatever happens next: a failing hook is logged, never a failed placement. */
  private async announcePlaced(identity: MediaIdentity): Promise<void> {
    const { section, folders } = this.placementOf(identity);
    if (!identity.imdbId || !folders[0]) {
      return;
    }
    await this.onPlaced({ imdbId: identity.imdbId, section, folder: folders[0] }).catch((error: unknown) => {
      MediaLabelizerService.logger.error(`After placing ${identity.imdbId}: ${(error as Error).message}`);
    });
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
