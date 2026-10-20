import { isBeforePlayhead, isMissing, Playhead, PlannerEpisode, runtimeHoursOf, sortEpisodes } from './model';

/** How one user perceives one missing episode: window offset and runway context. */
export type MissingEpisodeView = {
  mediaId: string;
  /** Unwatched viewing hours between the playhead and this episode. */
  hoursFromPlayhead: number;
  isFirstMissing: boolean;
  /** Hours of consecutively available, unwatched content ahead of the playhead. */
  runwayHours: number;
};

/**
 * Walk a user's remaining episodes in viewing order and situate every missing
 * episode in their unwatched viewing time. Episodes that are neither available
 * nor requested are holes: skipped without advancing the clock.
 * A completed/dropped playhead (nulls) yields no view — nothing is ahead.
 */
export function walkFromPlayhead(episodes: PlannerEpisode[], playhead: Playhead): MissingEpisodeView[] {
  if (playhead.nextSeason === null || playhead.nextEpisode === null) {
    return [];
  }

  const views: MissingEpisodeView[] = [];
  let hours = 0;
  let runwayHours: number | null = null;

  for (const episode of sortEpisodes(episodes)) {
    if (isBeforePlayhead(episode, playhead)) {
      continue;
    }

    if (isMissing(episode)) {
      runwayHours ??= hours;
      views.push({
        mediaId: episode.mediaId,
        hoursFromPlayhead: hours,
        isFirstMissing: views.length === 0,
        runwayHours,
      });
    } else if (!episode.available) {
      continue;
    }

    hours += runtimeHoursOf(episode);
  }

  return views;
}

/** Hours of consecutively available, unwatched content ahead of the playhead. */
export function computeRunwayHours(episodes: PlannerEpisode[], playhead: Playhead): number {
  if (playhead.nextSeason === null || playhead.nextEpisode === null) {
    return 0;
  }

  let hours = 0;
  for (const episode of sortEpisodes(episodes)) {
    if (isBeforePlayhead(episode, playhead)) {
      continue;
    }
    if (!episode.available) {
      if (isMissing(episode)) {
        break;
      }
      continue;
    }
    hours += runtimeHoursOf(episode);
  }
  return hours;
}
