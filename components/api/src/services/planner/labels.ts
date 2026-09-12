import { maxLabel, Playhead, PlanLabel, PlannerEpisode, START_OF_SHOW } from './model';
import { walkFromPlayhead } from './runway';

/**
 * Label every missing episode of a show, merging all users by max urgency
 * (the most starved user wins — equivalent to the min-runway merge).
 *
 * - `starved`: first missing episode of a user whose runway is empty — they are stalled.
 * - `needed`: missing episode within the first `needWindowHours` of unwatched viewing time.
 * - `deferred`: in the intent but beyond the window.
 *
 * A user with a completed/dropped playhead (nulls) contributes `deferred` for every
 * missing episode: the intent survives (e.g. HIGH_RATED rewatch) but carries no urgency.
 * No playheads at all means nobody started the show: labels run from the first episode.
 */
export function labelEpisodes(
  episodes: PlannerEpisode[],
  playheads: Playhead[],
  needWindowHours: number,
): Map<string, PlanLabel> {
  const result = new Map<string, PlanLabel>();
  const effectivePlayheads = playheads.length > 0 ? playheads : [START_OF_SHOW];

  for (const playhead of effectivePlayheads) {
    const completed = playhead.nextSeason === null || playhead.nextEpisode === null;
    const walked = walkFromPlayhead(episodes, completed ? START_OF_SHOW : playhead);

    for (const view of walked) {
      const label = completed
        ? PlanLabel.Deferred
        : view.isFirstMissing && view.runwayHours === 0
          ? PlanLabel.Starved
          : view.hoursFromPlayhead < needWindowHours
            ? PlanLabel.Needed
            : PlanLabel.Deferred;

      const previous = result.get(view.mediaId);
      result.set(view.mediaId, previous ? maxLabel(previous, label) : label);
    }
  }

  return result;
}
