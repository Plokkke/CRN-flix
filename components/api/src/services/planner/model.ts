import { DEFAULT_EPISODE_RUNTIME_MINUTES } from '@/modules/indexer/contract';

/**
 * Pure domain model of the download planner. Everything here is derived state:
 * labels and plans are pure functions of intent, availability, playheads and
 * candidates — recomputed from scratch on every pass, never transitioned.
 */

export enum PlanLabel {
  Starved = 'starved',
  Needed = 'needed',
  Deferred = 'deferred',
}

const LABEL_URGENCY: Record<PlanLabel, number> = {
  [PlanLabel.Starved]: 2,
  [PlanLabel.Needed]: 1,
  [PlanLabel.Deferred]: 0,
};

export function urgencyOf(label: PlanLabel): number {
  return LABEL_URGENCY[label];
}

export function maxLabel(a: PlanLabel, b: PlanLabel): PlanLabel {
  return urgencyOf(a) >= urgencyOf(b) ? a : b;
}

export { DEFAULT_EPISODE_RUNTIME_MINUTES };

/**
 * One episode of a show as the planner sees it. Movies are the degenerate
 * single-episode case (season 0, episode 0).
 */
export type PlannerEpisode = {
  mediaId: string;
  season: number;
  episode: number;
  runtimeMinutes: number | null;
  /** Fulfilled in Jellyfin. */
  available: boolean;
  /** Part of the intent (a non-rejected request exists). */
  requested: boolean;
};

export function isMissing(episode: PlannerEpisode): boolean {
  return episode.requested && !episode.available;
}

export function runtimeHoursOf(episode: PlannerEpisode): number {
  return (episode.runtimeMinutes ?? DEFAULT_EPISODE_RUNTIME_MINUTES) / 60;
}

/**
 * A user's position in a show. `null` season/episode means the user completed
 * or dropped the show: nothing is urgent for them anymore.
 */
export type Playhead = {
  nextSeason: number | null;
  nextEpisode: number | null;
};

/** A user who never started the show: everything lies ahead of them. */
export const START_OF_SHOW: Playhead = { nextSeason: 0, nextEpisode: 0 };

export function sortEpisodes(episodes: PlannerEpisode[]): PlannerEpisode[] {
  return [...episodes].sort((a, b) => a.season - b.season || a.episode - b.episode);
}

export function isBeforePlayhead(episode: PlannerEpisode, playhead: Playhead): boolean {
  if (playhead.nextSeason === null || playhead.nextEpisode === null) {
    return false;
  }
  return (
    episode.season < playhead.nextSeason ||
    (episode.season === playhead.nextSeason && episode.episode < playhead.nextEpisode)
  );
}
