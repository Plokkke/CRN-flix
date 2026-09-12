import { IndexerTarget, RejectReason } from '@/modules/indexer/contract';
import { EnginePreferences, Host, Language, Quality } from '@/modules/indexer/preferences';
import { PlannedDownloadEntity, PlannedDownloadStatus } from '@/services/database/planned-downloads';
import { PlanLabel } from '@/services/planner/model';
import { staleProposals } from '@/services/planner/revalidate';

const target: IndexerTarget = {
  kind: 'show',
  imdbId: 'tt2887954',
  title: 'Tokyo Vice',
  originalTitle: null,
  year: 2022,
  episodes: Array.from({ length: 8 }, (_, i) => ({ season: 1, episode: i + 1, runtimeMinutes: 55 })),
};

const prefs: EnginePreferences = {
  allowedQualities: [Quality.HD_1080P],
  allowedLanguages: [Language.MULTI],
  allowedHosts: [Host.ONE_FICHIER],
  sizePolicy: { bytesPerMinute: { [Quality.HD_1080P]: 24_000_000 }, tolerance: 1 },
};

function action(overrides: Partial<PlannedDownloadEntity> = {}): PlannedDownloadEntity {
  return {
    id: 'a1',
    showImdbId: 'tt2887954',
    scope: { kind: 'season', season: 1 },
    indexerName: 'loadix',
    url: 'https://loadix.test/media/1',
    quality: Quality.HD_1080P,
    language: Language.MULTI,
    host: Host.ONE_FICHIER,
    sizeBytes: 18.7 * 1024 ** 3,
    label: PlanLabel.Needed,
    status: PlannedDownloadStatus.Proposed,
    alternatives: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    coveredMediaIds: [],
    coveredStatuses: [],
    ...overrides,
  };
}

describe('staleProposals', () => {
  it('flags a proposed season pack that exceeds the size cap of its episodes', () => {
    const stale = staleProposals([action()], target, prefs);

    expect(stale).toEqual([{ action: expect.objectContaining({ id: 'a1' }), reasons: [RejectReason.SizeExceeded] }]);
  });

  it('keeps a proposal that still passes', () => {
    expect(staleProposals([action({ sizeBytes: 9 * 1024 ** 3 })], target, prefs)).toEqual([]);
  });

  it('never touches a download already running', () => {
    expect(staleProposals([action({ status: PlannedDownloadStatus.Downloading })], target, prefs)).toEqual([]);
  });
});
