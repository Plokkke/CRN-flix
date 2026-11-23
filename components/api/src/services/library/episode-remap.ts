import * as path from 'path';

import { isVideoFile } from '@/services/video-files';

/** The episodes a file holds, as its name tells them. */
export type EpisodeRange = { start: number; end: number };

export type EpisodeTag = EpisodeRange & { season: number };

/** A video of a title folder; `relativePath` is relative to the series store, title folder first. */
export type EpisodeFile = { relativePath: string; tag: EpisodeTag | null };

/** What the admin wants a file to hold; a file left out keeps its name. */
export type Assignment = EpisodeRange & { relativePath: string };

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

/** Every episode number and the files that claim it once the assignments apply. */
export function claims(files: EpisodeFile[], assignments: Assignment[]): Map<number, string[]> {
  const assigned = new Map(assignments.map((assignment) => [assignment.relativePath, assignment]));
  const byEpisode = new Map<number, string[]>();
  files.forEach((file) => {
    const range = assigned.get(file.relativePath) ?? file.tag;
    (range ? episodesOf(range) : []).forEach((episode) => {
      byEpisode.set(episode, [...(byEpisode.get(episode) ?? []), file.relativePath]);
    });
  });
  return byEpisode;
}

/** Why the assignments cannot apply; empty when they can. */
export function remapProblems(files: EpisodeFile[], assignments: Assignment[]): string[] {
  const known = new Set(files.map((file) => file.relativePath));
  const unknown = assignments.filter((assignment) => !known.has(assignment.relativePath));
  const invalid = assignments.filter(({ start, end }) => !Number.isInteger(start) || start < 1 || end < start);
  const conflicts = [...claims(files, assignments).entries()].filter(([, holders]) => holders.length > 1);
  return [
    ...unknown.map((assignment) => `Fichier inconnu : ${assignment.relativePath}`),
    ...invalid.map((assignment) => `Plage invalide pour ${path.basename(assignment.relativePath)}`),
    ...conflicts.map(([episode, holders]) => `E${episode} revendiqué par ${holders.length} fichiers`),
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
