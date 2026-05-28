import * as fs from 'fs/promises';
import * as path from 'path';

import { Logger } from '@nestjs/common';
import { z } from 'zod';

import { IdentificationResult } from './media-identifier';

export type MediaIdentity = Pick<
  IdentificationResult,
  'title' | 'year' | 'imdbId' | 'mediaType' | 'seasonNumber' | 'episodeNumber' | 'episodeNumberEnd'
>;

export const mediaPathsConfigSchema = z.object({
  downloads: z.string(),
  movies: z.string(),
  series: z.string(),
  privateMovies: z.string(),
  privateSeries: z.string(),
});

export type MediaPathsConfig = z.infer<typeof mediaPathsConfigSchema>;

export type PlacementResult = {
  destinationPath: string;
};

export type PlacementOptions = {
  isPrivate?: boolean;
};

function isPrivateMetadata(metadata?: Record<string, string> | null): boolean {
  return metadata?.private === 'true';
}

function sanitizeTitle(title: string): string {
  return title
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/['']/g, '.')
    .replace(/[\s-]+/g, '.')
    .replace(/[^a-zA-Z0-9.]/g, '')
    .replace(/\.{2,}/g, '.');
}

function buildFolderName(title: string, year: number | null, imdbId: string | null): string {
  const parts = [sanitizeTitle(title)];
  if (year) {
    parts.push(`(${year})`);
  }
  if (imdbId) {
    parts.push(`[imdbid-${imdbId}]`);
  }
  return parts.join('.');
}

export class MediaLabelizerService {
  private static readonly logger = new Logger(MediaLabelizerService.name);

  constructor(private readonly config: MediaPathsConfig) {}

  generateDestination(identity: MediaIdentity, opts: PlacementOptions = {}): [string, string] {
    const idName = buildFolderName(identity.title, identity.year, identity.imdbId);

    let folderName;
    let fileName;

    if (identity.mediaType === 'episode') {
      const season = identity.seasonNumber ?? 0;
      const episode = identity.episodeNumber ?? 0;
      const root = opts.isPrivate ? this.config.privateSeries : this.config.series;
      const seasonPad = String(season).padStart(2, '0');
      const episodePad = String(episode).padStart(2, '0');
      let sxxexx = `S${seasonPad}E${episodePad}`;
      if (identity.episodeNumberEnd && identity.episodeNumberEnd !== episode) {
        sxxexx += `-E${String(identity.episodeNumberEnd).padStart(2, '0')}`;
      }
      folderName = path.join(root, idName, `Season${seasonPad}`);
      const parts = [sanitizeTitle(identity.title)];
      if (identity.year) {
        parts.push(`(${identity.year})`);
      }
      parts.push(sxxexx);
      if (identity.imdbId) {
        parts.push(`[imdbid-${identity.imdbId}]`);
      }
      fileName = parts.join('.');
    } else {
      const root = opts.isPrivate ? this.config.privateMovies : this.config.movies;
      folderName = path.join(root, idName);
      fileName = idName;
    }

    return [folderName, fileName];
  }

  async move(
    sourcePath: string,
    identity: IdentificationResult,
    metadata?: Record<string, string> | null,
  ): Promise<void> {
    const isPrivate = isPrivateMetadata(metadata);
    const [folderName, fileName] = this.generateDestination(identity, { isPrivate });
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
