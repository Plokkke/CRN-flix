import { IndexerCandidate } from '@/modules/indexer/contract';
import { Host, Language, Quality } from '@/modules/indexer/preferences';
import { diffPlan, LiveAction } from '@/services/planner/diff';
import { PlanLabel } from '@/services/planner/model';
import { ChosenAction } from '@/services/planner/resolve';

function candidate(scope: IndexerCandidate['scope'], url = 'https://loadix.test/media/x'): IndexerCandidate {
  return {
    indexerName: 'loadix',
    url,
    scope,
    quality: Quality.HD_1080P,
    language: Language.MULTI,
    host: Host.ONE_FICHIER,
    sizeBytes: null,
  };
}

function chosen(scope: IndexerCandidate['scope'], coveredMediaIds: string[]): ChosenAction {
  return { candidate: candidate(scope), coveredMediaIds, label: PlanLabel.Needed, alternatives: [] };
}

function live(
  id: string,
  scope: LiveAction['scope'],
  coveredMediaIds: string[],
  status: LiveAction['status'] = 'proposed',
): LiveAction {
  return { id, scope, status, coveredMediaIds };
}

describe('diffPlan', () => {
  it('creates actions that have no live counterpart', () => {
    const diff = diffPlan([chosen({ kind: 'season', season: 1 }, ['e1', 'e2'])], [], new Set(['e1', 'e2']));

    expect(diff.create).toHaveLength(1);
    expect(diff.refresh).toEqual([]);
    expect(diff.supersede).toEqual([]);
  });

  it('refreshes a live action whose scope survives in the plan', () => {
    const action = live('a1', { kind: 'season', season: 1 }, ['e1']);
    const diff = diffPlan([chosen({ kind: 'season', season: 1 }, ['e1', 'e2'])], [action], new Set(['e1', 'e2']));

    expect(diff.create).toEqual([]);
    expect(diff.refresh).toHaveLength(1);
    expect(diff.refresh[0].live.id).toBe('a1');
  });

  it('canonical: in-flight singles are superseded when the plan switches to the pack', () => {
    const e6 = live('a6', { kind: 'episode', season: 1, episode: 6 }, ['e6'], 'downloading');
    const e8 = live('a8', { kind: 'episode', season: 1, episode: 8 }, ['e8'], 'downloading');
    const pack = chosen({ kind: 'season', season: 1 }, ['e6', 'e7', 'e8']);

    const diff = diffPlan([pack], [e6, e8], new Set(['e6', 'e7', 'e8']));

    expect(diff.create).toHaveLength(1);
    expect(diff.supersede.map((a) => a.id)).toEqual(expect.arrayContaining(['a6', 'a8']));
    expect(diff.keep).toEqual([]);
  });

  it('keeps a live action that still covers episodes the plan does not (admin free-will)', () => {
    const wideAction = live('a1', { kind: 'series' }, ['e1', 'e2', 'e3']);
    const narrowPlan = chosen({ kind: 'episode', season: 1, episode: 1 }, ['e1']);

    const diff = diffPlan([narrowPlan], [wideAction], new Set(['e1', 'e2', 'e3']));

    expect(diff.keep.map((a) => a.id)).toEqual(['a1']);
    expect(diff.supersede).toEqual([]);
  });

  it('ignores no-longer-missing coverage when checking domination', () => {
    // Live single covers e1 which has been fulfilled meanwhile: dominated by anything.
    const stale = live('a1', { kind: 'episode', season: 1, episode: 1 }, ['e1']);
    const diff = diffPlan([chosen({ kind: 'episode', season: 1, episode: 2 }, ['e2'])], [stale], new Set(['e2']));

    expect(diff.supersede.map((a) => a.id)).toEqual(['a1']);
  });

  it('is level-based: same scope matches even when the candidate url changed', () => {
    const action = live('a1', { kind: 'season', season: 1 }, ['e1']);
    const rescanned: ChosenAction = {
      ...chosen({ kind: 'season', season: 1 }, ['e1']),
      candidate: candidate({ kind: 'season', season: 1 }, 'https://loadix.test/media/other'),
    };

    const diff = diffPlan([rescanned], [action], new Set(['e1']));

    expect(diff.refresh).toHaveLength(1);
    expect(diff.create).toEqual([]);
  });
});
