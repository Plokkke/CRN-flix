import * as fs from 'fs/promises';
import * as path from 'path';

import { Logger } from '@nestjs/common';
import { z } from 'zod';

import { JellyfinMedia, JellyfinMediaService } from '@/modules/jellyfin/jellyfin';
import {
  NamingAuditItemEntity,
  NamingAuditItemInput,
  NamingAuditMediaType,
  NamingAuditRepository,
} from '@/services/database/naming-audit';
import { EnglishTitleResolver } from '@/services/english-title-resolver';
import { MediaIdentity, MediaLabelizerService } from '@/services/media-labelizer';

export const namingAuditConfigSchema = z.object({
  jellyfinLibraryRoot: z.string(),
  engineMediasPath: z.string(),
});

export type NamingAuditConfig = z.infer<typeof namingAuditConfigSchema>;

const VIDEO_EXTENSIONS = new Set(['.mkv', '.mp4', '.avi', '.m4v', '.mov', '.wmv', '.ts', '.webm']);

type AuditCandidate = {
  mediaType: NamingAuditMediaType;
  imdbId: string | null;
  jellyfinAbsolutePath: string;
  identity: MediaIdentity | null;
  englishTitle: string | null;
  reasonHints: string[];
};

function resolveSeriesImdb(assets: JellyfinMedia[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const m of assets) {
    if (m.Type === 'Series' && m.ProviderIds?.Imdb) {
      map.set(m.Id, m.ProviderIds.Imdb);
    }
  }
  return map;
}

export class NamingAuditService {
  private static readonly logger = new Logger(NamingAuditService.name);

  constructor(
    private readonly config: NamingAuditConfig,
    private readonly jellyfin: JellyfinMediaService,
    private readonly labelizer: MediaLabelizerService,
    private readonly englishTitle: EnglishTitleResolver,
    private readonly auditRepo: NamingAuditRepository,
  ) {}

  async run(): Promise<string> {
    NamingAuditService.logger.log('Starting naming audit run');

    const assets = await this.jellyfin.listAssets({ requireImdbId: false });
    NamingAuditService.logger.log(`Jellyfin returned ${assets.length} assets`);

    const seriesImdbById = resolveSeriesImdb(assets);

    const items: NamingAuditItemInput[] = [];
    let conformingCount = 0;
    let flaggedCount = 0;
    let skippedNoPath = 0;

    for (const asset of assets) {
      if (asset.Type !== 'Movie' && asset.Type !== 'Episode') {
        continue;
      }
      if (!asset.Path) {
        skippedNoPath += 1;
        continue;
      }

      const candidate = await this.buildCandidate(asset, seriesImdbById);
      const item = this.evaluateCandidate(candidate);

      if (item.status === 'conforming') {
        conformingCount += 1;
      } else {
        flaggedCount += 1;
      }
      items.push(item);
    }

    const runId = await this.auditRepo.insertRun(items);

    NamingAuditService.logger.log(
      `Naming audit completed: run=${runId} flagged=${flaggedCount} conforming=${conformingCount} skipped(no-path)=${skippedNoPath}`,
    );

    return runId;
  }

  async apply(itemIds: string[]): Promise<{ applied: number; failed: number }> {
    if (itemIds.length === 0) {
      return { applied: 0, failed: 0 };
    }

    const items = await this.auditRepo.getByIds(itemIds);
    NamingAuditService.logger.log(`Applying renames on ${items.length} audit items`);

    let applied = 0;
    let failed = 0;

    for (const item of items) {
      if (item.status === 'applied') {
        continue;
      }
      if (item.reasons.includes('missing-imdb') || item.reasons.includes('tmdb-not-found')) {
        await this.auditRepo.markFailed(item.id, 'cannot rename without canonical metadata');
        failed += 1;
        continue;
      }

      try {
        await this.renameItem(item);
        await this.auditRepo.markApplied(item.id);
        applied += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        NamingAuditService.logger.error(`Rename failed for ${item.id} (${item.currentPath}): ${message}`);
        await this.auditRepo.markFailed(item.id, message);
        failed += 1;
      }
    }

    if (applied > 0) {
      try {
        await this.jellyfin.refreshLibrary();
      } catch (error) {
        NamingAuditService.logger.warn(
          `Jellyfin refresh failed after apply: ${error instanceof Error ? error.message : error}`,
        );
      }
    }

    NamingAuditService.logger.log(`Apply done: applied=${applied} failed=${failed}`);
    return { applied, failed };
  }

  private async buildCandidate(asset: JellyfinMedia, seriesImdbById: Map<string, string>): Promise<AuditCandidate> {
    const reasonHints: string[] = [];

    let imdbId: string | null = asset.ProviderIds?.Imdb ?? null;
    if (asset.Type === 'Episode') {
      const seriesImdb = asset.SeriesId ? seriesImdbById.get(asset.SeriesId) : undefined;
      imdbId = seriesImdb ?? imdbId;
      if (!seriesImdb && asset.SeriesId) {
        reasonHints.push('unresolved-series-imdb');
      }
    }

    if (!imdbId) {
      reasonHints.push('missing-imdb');
      return {
        mediaType: asset.Type === 'Movie' ? 'movie' : 'episode',
        imdbId: null,
        jellyfinAbsolutePath: asset.Path!,
        identity: null,
        englishTitle: null,
        reasonHints,
      };
    }

    const tmdbResolution = await this.englishTitle.resolve(imdbId);
    if (!tmdbResolution.title) {
      reasonHints.push('tmdb-not-found');
    }

    const fallbackTitle = asset.Type === 'Movie' ? asset.Name : (asset.SeriesName ?? asset.Name);
    const title = tmdbResolution.title ?? fallbackTitle;
    const year = tmdbResolution.year ?? asset.ProductionYear ?? null;

    if (!year) {
      reasonHints.push('missing-year');
    }

    const identity: MediaIdentity = {
      title,
      year,
      imdbId,
      mediaType: asset.Type === 'Movie' ? 'movie' : 'episode',
      seasonNumber: asset.ParentIndexNumber ?? null,
      episodeNumber: asset.IndexNumber ?? null,
      episodeNumberEnd: asset.IndexNumberEnd ?? null,
    };

    return {
      mediaType: identity.mediaType,
      imdbId,
      jellyfinAbsolutePath: asset.Path!,
      identity,
      englishTitle: tmdbResolution.title,
      reasonHints,
    };
  }

  private evaluateCandidate(candidate: AuditCandidate): NamingAuditItemInput {
    const enginePath = this.toEnginePath(candidate.jellyfinAbsolutePath);
    const reasons = [...candidate.reasonHints];

    if (!candidate.identity) {
      return {
        mediaType: candidate.mediaType,
        imdbId: candidate.imdbId,
        currentPath: enginePath,
        expectedPath: enginePath,
        reasons,
        englishTitle: candidate.englishTitle,
        year: null,
        seasonNumber: null,
        episodeNumber: null,
        status: 'pending',
      };
    }

    const [folder, fileName] = this.labelizer.generateDestination(candidate.identity);
    const ext = path.extname(candidate.jellyfinAbsolutePath);
    const expectedPath = path.join(folder, `${fileName}${ext}`);

    if (path.normalize(expectedPath) !== path.normalize(enginePath)) {
      const currentBasename = path.basename(enginePath, ext);
      if (currentBasename !== fileName) {
        reasons.push('wrong-filename');
      }
      const currentFolder = path.dirname(enginePath);
      const expectedFolder = path.dirname(expectedPath);
      if (currentFolder !== expectedFolder) {
        reasons.push('wrong-folder');
      }
      if (!enginePath.includes('[imdbid-')) {
        reasons.push('missing-imdbid-suffix');
      }
      if (/[^\x00-\x7f]/.test(enginePath)) {
        reasons.push('non-ascii');
      }
    }

    const status = reasons.length === 0 ? 'conforming' : 'pending';

    return {
      mediaType: candidate.mediaType,
      imdbId: candidate.imdbId,
      currentPath: enginePath,
      expectedPath,
      reasons,
      englishTitle: candidate.englishTitle,
      year: candidate.identity.year,
      seasonNumber: candidate.identity.seasonNumber,
      episodeNumber: candidate.identity.episodeNumber,
      status,
    };
  }

  private async renameItem(item: NamingAuditItemEntity): Promise<void> {
    if (item.currentPath === item.expectedPath) {
      return;
    }

    const ext = path.extname(item.currentPath);
    if (!VIDEO_EXTENSIONS.has(ext.toLowerCase())) {
      throw new Error(`unsupported extension ${ext}`);
    }

    await fs.mkdir(path.dirname(item.expectedPath), { recursive: true });
    await fs.rename(item.currentPath, item.expectedPath);

    await this.cleanupEmptyParents(path.dirname(item.currentPath));
  }

  private toEnginePath(jellyfinPath: string): string {
    const { jellyfinLibraryRoot, engineMediasPath } = this.config;
    if (jellyfinPath.startsWith(jellyfinLibraryRoot + '/')) {
      return path.join(engineMediasPath, jellyfinPath.slice(jellyfinLibraryRoot.length + 1));
    }
    if (jellyfinPath === jellyfinLibraryRoot) {
      return engineMediasPath;
    }
    return jellyfinPath;
  }

  private async cleanupEmptyParents(dir: string): Promise<void> {
    const stopAt = this.config.engineMediasPath;
    if (dir === stopAt || dir === path.dirname(dir) || !dir.startsWith(stopAt)) {
      return;
    }
    try {
      const entries = await fs.readdir(dir);
      if (entries.length === 0) {
        await fs.rmdir(dir);
        await this.cleanupEmptyParents(path.dirname(dir));
      }
    } catch {
      // ignore
    }
  }
}
