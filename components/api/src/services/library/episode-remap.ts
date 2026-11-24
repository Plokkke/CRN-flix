import * as path from 'path';

import { isVideoFile } from '@/services/video-files';

/** The episodes a file holds, as its name tells them. */
export type EpisodeRange = { start: number; end: number };

export type EpisodeTag = EpisodeRange & { season: number };

/** A video of a title folder; `relativePath` is relative to the series store, title folder first. */
export type EpisodeFile = { relativePath: string; tag: EpisodeTag | null };

/** What the admin wants a file to hold, in any season; a file left out keeps its name. */
export type Assignment = EpisodeTag & { relativePath: string };

export type Move = { from: string; to: string };

const TAG = /S(\d{1,3})[ ._-]?E(\d{1,4})(?:[-._ ]*E(\d{1,4}))?/i;
const SEASON_FOLDER = /^Season[ ._-]?(\d{1,3})$/i;

export function parseEpisodeTag(fileName: string): EpisodeTag | null {
  const match = TAG.exec(fileName);
  if (!match) {
    return null;
  }
  const start = Number(match[2]);
  return { season: Number(match[1]), start, end: match[3] ? Math.max(start, Number(match[3])) : start };
}

/** The file's own tag, else the season folder it sits in (a tag-less file is on every season). */
export function seasonOf(file: EpisodeFile): number | null {
  if (file.tag) {
    return file.tag.season;
  }
  const folder = SEASON_FOLDER.exec(path.basename(path.dirname(file.relativePath)));
  return folder ? Number(folder[1]) : null;
}

export const episodesOf = ({ start, end }: EpisodeRange): number[] =>
  Array.from({ length: end - start + 1 }, (_, index) => start + index);

const pad = (value: number): string => String(value).padStart(2, '0');

/** `S07E40`: how an episode is named in messages and keyed in claims. */
export const episodeKey = (season: number, episode: number): string => `S${pad(season)}E${pad(episode)}`;

/** Every episode and the files that claim it once the assignments apply, whatever their season. */
export function claims(files: EpisodeFile[], assignments: Assignment[]): Map<string, string[]> {
  const assigned = new Map(assignments.map((assignment) => [assignment.relativePath, assignment]));
  const byEpisode = new Map<string, string[]>();
  files.forEach((file) => {
    const tag = assigned.get(file.relativePath) ?? file.tag;
    if (!tag) {
      return;
    }
    episodesOf(tag).forEach((episode) => {
      const key = episodeKey(tag.season, episode);
      byEpisode.set(key, [...(byEpisode.get(key) ?? []), file.relativePath]);
    });
  });
  return byEpisode;
}

const isValid = ({ season, start, end }: Assignment): boolean =>
  [season, start, end].every(Number.isInteger) && season >= 0 && start >= 1 && end >= start;

/** Why the assignments cannot apply; empty when they can. `files` are every file of the show. */
export function remapProblems(files: EpisodeFile[], assignments: Assignment[]): string[] {
  const known = new Set(files.map((file) => file.relativePath));
  const unknown = assignments.filter((assignment) => !known.has(assignment.relativePath));
  const invalid = assignments.filter((assignment) => !isValid(assignment));
  const conflicts = [...claims(files, assignments).entries()].filter(([, holders]) => holders.length > 1);
  return [
    ...unknown.map((assignment) => `Fichier inconnu : ${assignment.relativePath}`),
    ...invalid.map((assignment) => `Saison ou épisodes invalides pour ${path.basename(assignment.relativePath)}`),
    ...conflicts.map(([episode, holders]) => `${episode} revendiqué par ${holders.length} fichiers`),
  ];
}

/**
 * The side files (`.srt`, `.nfo`…) of each video of a folder: those named after it, given to the
 * longest video name they start with (so `A.part2.srt` follows `A.part2.mkv`, not `A.mkv`).
 */
export function sideFilesOf(video: string, siblings: string[]): string[] {
  const baseOf = (name: string): string => name.slice(0, name.length - path.extname(name).length);
  const videos = siblings.filter(isVideoFile).map(baseOf);
  const own = baseOf(video);
  return siblings.filter((name) => {
    if (isVideoFile(name) || !name.startsWith(`${own}.`)) {
      return false;
    }
    return !videos.some((other) => other.length > own.length && name.startsWith(`${other}.`));
  });
}

/** `from`'s side file renamed after the video's new name (`X.fr.srt` → `Y.fr.srt`). */
export function sideFileTarget(video: Move, sideFile: string): string {
  const oldBase = path.basename(video.from, path.extname(video.from));
  const newBase = path.basename(video.to, path.extname(video.to));
  return path.join(path.dirname(video.to), `${newBase}${sideFile.slice(oldBase.length)}`);
}

/**
 * Moves through a temporary name first, so files that swap names never overwrite each other.
 * `temporary` must name a path that exists nowhere.
 */
export function twoPhase(moves: Move[], temporary: (move: Move, index: number) => string): Move[][] {
  const parked = moves.map((move, index) => ({ ...move, via: temporary(move, index) }));
  return [parked.map(({ from, via }) => ({ from, to: via })), parked.map(({ via, to }) => ({ from: via, to }))];
}
