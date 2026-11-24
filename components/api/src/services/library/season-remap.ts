import * as fs from 'fs/promises';
import * as path from 'path';

import { Logger } from '@nestjs/common';

import { Catalog, CatalogEpisode, LibraryLayout, MediaType, MetadataSource, Player } from '@crn-flix/contracts';

import { LibraryTitlesRepository } from '@/services/database/library';
import { MediasRepository } from '@/services/database/medias';
import {
  Assignment,
  EpisodeFile,
  Move,
  parseEpisodeTag,
  remapProblems,
  seasonOf,
  sideFilesOf,
  sideFileTarget,
  twoPhase,
} from '@/services/library/episode-remap';
import { LibraryPaths } from '@/services/library/paths';
import { isVideoFile } from '@/services/video-files';

const describeError = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** The admin's mapping cannot apply as is; nothing was moved. */
export class RemapRefusedError extends Error {
  constructor(readonly problems: string[]) {
    super(problems.join(' · '));
    this.name = 'RemapRefusedError';
  }
}

/** `diskPath` is relative to the disk the store and the downloads share: what a preview link serves. */
export type PageFile = EpisodeFile & { diskPath: string };

export type SeasonPage = {
  imdbId: string;
  title: string;
  seasons: number[];
  season: number;
  /** The season's files, and those whose name tells no season. */
  files: PageFile[];
  /** The show's other files, which a file of this page may collide with once moved to another season. */
  others: EpisodeFile[];
  /** The whole show: the page lists its season, the search looks everywhere. */
  episodes: CatalogEpisode[];
  catalogError: string | null;
};

/** A file whose episodes do not change keeps its name, whatever it looks like. */
const keepsItsTag = (files: EpisodeFile[], { relativePath, season, start, end }: Assignment): boolean => {
  const tag = files.find((file) => file.relativePath === relativePath)?.tag;
  return tag?.season === season && tag.start === start && tag.end === end;
};

const sortedUnique = (values: number[]): number[] => [...new Set(values)].sort((a, b) => a - b);

const exists = (target: string): Promise<boolean> =>
  fs.access(target).then(
    () => true,
    () => false,
  );

const temporaryName = (move: Move, index: number): string =>
  path.join(path.dirname(move.from), `.crn-remap-${process.pid}-${index}-${path.basename(move.from)}`);

/**
 * A one-off correction of a season whose files carry the wrong episode numbers (two episodes
 * per file, shuffled by the release): the admin tells which episodes each file holds, files are
 * renamed in place in the store, inside their own title folder. The shelves link to title
 * folders, so nothing else moves; the player rescans afterwards.
 */
export class SeasonRemapService {
  private static readonly logger = new Logger(SeasonRemapService.name);

  constructor(
    private readonly paths: LibraryPaths,
    private readonly titles: LibraryTitlesRepository,
    private readonly catalog: Catalog,
    private readonly metadata: MetadataSource,
    private readonly medias: MediasRepository,
    private readonly layout: LibraryLayout,
    private readonly player: Player,
    /** The common root of the store and the downloads, as the engine sees it. */
    private readonly diskRoot: string,
  ) {}

  private get root(): string {
    return this.paths.store('series');
  }

  async files(imdbId: string): Promise<EpisodeFile[]> {
    const folders = (await this.titles.list())
      .filter((title) => title.section === 'series' && title.imdbId === imdbId)
      .map((title) => title.folder);
    const listed = await Promise.all(
      folders.map(async (folder) => {
        const entries = await fs.readdir(path.join(this.root, folder), { recursive: true }).catch(() => []);
        return entries.filter(isVideoFile).map((entry) => path.join(folder, entry));
      }),
    );
    return listed
      .flat()
      .sort((a, b) => a.localeCompare(b))
      .map((relativePath) => ({ relativePath, tag: parseEpisodeTag(path.basename(relativePath)) }));
  }

  async page(imdbId: string, season: number | null): Promise<SeasonPage | null> {
    const files = await this.files(imdbId);
    if (files.length === 0) {
      return null;
    }
    const [titles, catalog] = await Promise.all([this.medias.displayTitlesOf([imdbId]), this.episodes(imdbId)]);
    const onDisk = sortedUnique(files.map(seasonOf).filter((value): value is number => value !== null));
    const current = season ?? onDisk[0] ?? catalog.episodes[0]?.season ?? 1;
    const shown = files.filter((file) => [current, null].includes(seasonOf(file)));
    return {
      imdbId,
      title: titles.get(imdbId) ?? imdbId,
      seasons: sortedUnique([...onDisk, ...catalog.episodes.map((episode) => episode.season), current]),
      season: current,
      files: shown.map((file) => ({
        ...file,
        diskPath: path.relative(this.diskRoot, path.join(this.root, file.relativePath)),
      })),
      others: files.filter((file) => !shown.includes(file)),
      ...catalog,
    };
  }

  private async episodes(imdbId: string): Promise<Pick<SeasonPage, 'episodes' | 'catalogError'>> {
    try {
      return { episodes: await this.catalog.episodes(imdbId), catalogError: null };
    } catch (error) {
      SeasonRemapService.logger.warn(`Episodes of ${imdbId} unavailable: ${describeError(error)}`);
      return { episodes: [], catalogError: describeError(error) };
    }
  }

  /** Renames the files whose episodes changed, across seasons; returns how many videos moved. */
  async apply(imdbId: string, assignments: Assignment[]): Promise<number> {
    const files = await this.files(imdbId);
    const problems = remapProblems(files, assignments);
    if (problems.length > 0) {
      throw new RemapRefusedError(problems);
    }
    const changed = assignments.filter((assignment) => !keepsItsTag(files, assignment));
    const videos = await this.videoMoves(imdbId, changed);
    const moves = [...videos, ...(await this.sideMoves(videos))];
    await this.refuseCollisions(moves);
    await this.execute(moves);
    await this.removeEmptyFolders(moves);
    SeasonRemapService.logger.log(`${imdbId}: ${videos.length} file(s) renamed`);
    if (videos.length > 0) {
      this.refreshInBackground();
    }
    return videos.length;
  }

  private async videoMoves(imdbId: string, assignments: Assignment[]): Promise<Move[]> {
    if (assignments.length === 0) {
      return [];
    }
    const { title, year } = await this.identity(imdbId);
    return assignments.flatMap(({ relativePath, season, start, end }) => {
      const placement = this.layout.place({
        imdbId,
        type: MediaType.Episode,
        title,
        year,
        seasonNumber: season,
        episodeNumber: start,
        episodeNumberEnd: end,
      });
      const titleFolder = relativePath.split(path.sep)[0];
      const fileName = `${placement.fileName}${path.extname(relativePath)}`;
      const to = path.join(this.root, titleFolder, ...placement.folders.slice(1), fileName);
      const from = path.join(this.root, relativePath);
      return from === to ? [] : [{ from, to }];
    });
  }

  /** The names the layout gives every placed file: the catalog's English title and year. */
  private async identity(imdbId: string): Promise<{ title: string; year: number | null }> {
    const described = await this.metadata.describe(imdbId);
    const stored = described.title ? null : await this.medias.titlesOf(imdbId);
    const title = described.title ?? stored?.title;
    if (!title) {
      throw new RemapRefusedError([`Titre inconnu pour ${imdbId} : impossible de nommer les fichiers`]);
    }
    return { title, year: described.year ?? stored?.year ?? null };
  }

  private async sideMoves(videos: Move[]): Promise<Move[]> {
    const listed = await Promise.all(
      videos.map(async (video) => {
        const siblings = await fs.readdir(path.dirname(video.from));
        return sideFilesOf(path.basename(video.from), siblings).map((side) => ({
          from: path.join(path.dirname(video.from), side),
          to: sideFileTarget(video, side),
        }));
      }),
    );
    return listed.flat();
  }

  /** A target may be a file that moves away too, never one that stays. */
  private async refuseCollisions(moves: Move[]): Promise<void> {
    const leaving = new Set(moves.map((move) => move.from));
    const targets = moves.map((move) => move.to);
    const duplicated = targets.filter((target, index) => targets.indexOf(target) !== index);
    const occupied = (
      await Promise.all(targets.map(async (target) => (!leaving.has(target) && (await exists(target)) ? target : null)))
    ).filter((target): target is string => target !== null);
    const problems = [...new Set([...duplicated, ...occupied])].map(
      (target) => `Déjà pris : ${path.relative(this.root, target)}`,
    );
    if (problems.length > 0) {
      throw new RemapRefusedError(problems);
    }
  }

  /** Every move or none: a failure puts the files already moved back where they were. */
  private async execute(moves: Move[]): Promise<void> {
    const done: Move[] = [];
    try {
      for (const phase of twoPhase(moves, temporaryName)) {
        for (const move of phase) {
          await fs.mkdir(path.dirname(move.to), { recursive: true });
          await fs.rename(move.from, move.to);
          done.push(move);
        }
      }
    } catch (error) {
      await this.rollBack(done);
      throw error;
    }
  }

  private async rollBack(done: Move[]): Promise<void> {
    for (const move of [...done].reverse()) {
      await fs.rename(move.to, move.from).catch((error: unknown) => {
        SeasonRemapService.logger.error(`Could not put ${move.to} back to ${move.from}: ${describeError(error)}`);
      });
    }
  }

  /** Folders a move emptied (an old `Season 1` next to the new `Season01`), never a title folder. */
  private async removeEmptyFolders(moves: Move[]): Promise<void> {
    const folders = [...new Set(moves.map((move) => path.dirname(move.from)))];
    const titleFolders = new Set(
      folders.map((folder) => path.join(this.root, path.relative(this.root, folder).split(path.sep)[0])),
    );
    await Promise.all(
      folders
        .filter((folder) => !titleFolders.has(folder))
        .map(async (folder) => {
          if ((await fs.readdir(folder).catch(() => ['?'])).length === 0) {
            await fs.rmdir(folder).catch(() => {});
          }
        }),
    );
  }

  /** The player rescans the whole library: it takes a while, the admin does not wait for it. */
  refreshInBackground(): void {
    this.player.refreshLibrary().catch((error: unknown) => {
      SeasonRemapService.logger.warn(`Library refresh failed: ${describeError(error)}`);
    });
  }
}
