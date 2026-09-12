import { labelEpisodes } from '@/services/planner/labels';
import { Playhead, PlanLabel, PlannerEpisode } from '@/services/planner/model';
import { computeRunwayHours, walkFromPlayhead } from '@/services/planner/runway';

/** 10 episodes of 90 minutes: E2 sits 1.5h from the playhead, E4 4.5h, E5 6h. */
function buildSeason(count: number, available: number[] = [], runtimeMinutes = 90): PlannerEpisode[] {
  return Array.from({ length: count }, (_, i) => ({
    mediaId: `ep-${i + 1}`,
    season: 1,
    episode: i + 1,
    runtimeMinutes,
    available: available.includes(i + 1),
    requested: !available.includes(i + 1),
  }));
}

const START: Playhead = { nextSeason: 0, nextEpisode: 0 };
const NEED_WINDOW_HOURS = 5;

describe('computeRunwayHours', () => {
  it('is zero when nothing is available ahead', () => {
    expect(computeRunwayHours(buildSeason(10), START)).toBe(0);
  });

  it('sums consecutive available episodes and stops at the first missing one', () => {
    const episodes = buildSeason(10, [1, 2]);
    expect(computeRunwayHours(episodes, START)).toBe(3);
  });

  it('is zero for a completed playhead', () => {
    expect(computeRunwayHours(buildSeason(10, [1, 2]), { nextSeason: null, nextEpisode: null })).toBe(0);
  });

  it('ignores episodes behind the playhead', () => {
    const episodes = buildSeason(10, [3, 4]);
    expect(computeRunwayHours(episodes, { nextSeason: 1, nextEpisode: 3 })).toBe(3);
  });
});

describe('walkFromPlayhead', () => {
  it('situates every missing episode in unwatched viewing time', () => {
    const views = walkFromPlayhead(buildSeason(3), START);
    expect(views.map((v) => v.hoursFromPlayhead)).toEqual([0, 1.5, 3]);
    expect(views[0].isFirstMissing).toBe(true);
    expect(views[1].isFirstMissing).toBe(false);
  });

  it('counts available unwatched episodes in the offset', () => {
    const views = walkFromPlayhead(buildSeason(3, [1]), START);
    expect(views.map((v) => v.mediaId)).toEqual(['ep-2', 'ep-3']);
    expect(views[0].hoursFromPlayhead).toBe(1.5);
    expect(views[0].runwayHours).toBe(1.5);
  });

  it('skips holes (neither available nor requested) without advancing the clock', () => {
    const episodes = buildSeason(3);
    episodes[0].requested = false; // rejected E1
    const views = walkFromPlayhead(episodes, START);
    expect(views[0].mediaId).toBe('ep-2');
    expect(views[0].hoursFromPlayhead).toBe(0);
  });
});

describe('labelEpisodes', () => {
  it('canonical: intent 1-10, nothing available → E1 starved, E2-E4 needed, E5-E10 deferred', () => {
    const labels = labelEpisodes(buildSeason(10), [START], NEED_WINDOW_HOURS);

    expect(labels.get('ep-1')).toBe(PlanLabel.Starved);
    expect(labels.get('ep-2')).toBe(PlanLabel.Needed);
    expect(labels.get('ep-3')).toBe(PlanLabel.Needed);
    expect(labels.get('ep-4')).toBe(PlanLabel.Needed);
    for (let i = 5; i <= 10; i++) {
      expect(labels.get(`ep-${i}`)).toBe(PlanLabel.Deferred);
    }
  });

  it('canonical: E1 downloaded but unwatched → nobody starved, E2-E4 needed', () => {
    const labels = labelEpisodes(buildSeason(10, [1]), [START], NEED_WINDOW_HOURS);

    expect(labels.get('ep-1')).toBeUndefined();
    expect(labels.get('ep-2')).toBe(PlanLabel.Needed);
    expect(labels.get('ep-3')).toBe(PlanLabel.Needed);
    expect(labels.get('ep-4')).toBe(PlanLabel.Needed);
    expect(labels.get('ep-5')).toBe(PlanLabel.Deferred);
    expect([...labels.values()]).not.toContain(PlanLabel.Starved);
  });

  it('canonical: multi-user merge takes the most urgent view (min runway wins)', () => {
    const episodes = buildSeason(10, [1, 2, 3]);
    // User A is at the start (3h of runway); user B is stalled right at E4.
    const userA = START;
    const userB: Playhead = { nextSeason: 1, nextEpisode: 4 };

    const labels = labelEpisodes(episodes, [userA, userB], NEED_WINDOW_HOURS);

    expect(labels.get('ep-4')).toBe(PlanLabel.Starved);
  });

  it('a completed/dropped playhead contributes deferred only', () => {
    const labels = labelEpisodes(buildSeason(10), [{ nextSeason: null, nextEpisode: null }], NEED_WINDOW_HOURS);

    expect(new Set(labels.values())).toEqual(new Set([PlanLabel.Deferred]));
    expect(labels.size).toBe(10);
  });

  it('no playhead at all behaves like a user waiting at the start of the show', () => {
    const labels = labelEpisodes(buildSeason(2), [], NEED_WINDOW_HOURS);

    expect(labels.get('ep-1')).toBe(PlanLabel.Starved);
    expect(labels.get('ep-2')).toBe(PlanLabel.Needed);
  });

  it('movies (single degenerate episode) are starved when missing', () => {
    const movie: PlannerEpisode = {
      mediaId: 'movie-1',
      season: 0,
      episode: 0,
      runtimeMinutes: 120,
      available: false,
      requested: true,
    };

    const labels = labelEpisodes([movie], [], NEED_WINDOW_HOURS);
    expect(labels.get('movie-1')).toBe(PlanLabel.Starved);
  });

  it('falls back to a default runtime when null', () => {
    const episodes = buildSeason(10).map((e) => ({ ...e, runtimeMinutes: null }));
    const labels = labelEpisodes(episodes, [START], NEED_WINDOW_HOURS);

    // 45 min default → E7 is at 4.5h (needed), E8 at 5.25h (deferred).
    expect(labels.get('ep-1')).toBe(PlanLabel.Starved);
    expect(labels.get('ep-7')).toBe(PlanLabel.Needed);
    expect(labels.get('ep-8')).toBe(PlanLabel.Deferred);
  });
});
