import { MediaType } from '@/services/database/medias';
import { RequestEntity, RequestStatus } from '@/services/database/requests';
import { episodeRangesBySeason, formatSeasonRanges, groupRequests } from '@/services/request-groups';

type MediaSpec = { imdbId: string; title: string; season?: number; episode?: number };

let counter = 0;

function request(spec: MediaSpec, status: RequestStatus, users: string[] = ['alice']): RequestEntity {
  counter += 1;
  const isEpisode = spec.season !== undefined;
  const now = new Date();
  return {
    mediaId: `media-${counter}`,
    status,
    createdAt: now,
    updatedAt: now,
    media: {
      id: `media-${counter}`,
      imdbId: spec.imdbId,
      type: isEpisode ? MediaType.Episode : MediaType.Movie,
      title: spec.title,
      originalTitle: null,
      year: 2020,
      seasonNumber: spec.season ?? null,
      episodeNumber: spec.episode ?? null,
      runtimeMinutes: null,
      traktSlug: null,
      createdAt: now,
      updatedAt: now,
    },
    userRequests: users.map((name) => ({
      requestId: `media-${counter}`,
      userId: name,
      reasons: [],
      createdAt: now,
      updatedAt: now,
      user: {
        id: name,
        name,
        jellyfinId: null,
        messagingKey: 'email',
        messagingId: name,
        status: 'active' as never,
        createdAt: now,
        updatedAt: now,
      },
    })),
  };
}

const ep = (season: number, episode: number): { seasonNumber: number; episodeNumber: number } => ({
  seasonNumber: season,
  episodeNumber: episode,
});

describe('episodeRangesBySeason', () => {
  it('collapses consecutive episodes into ranges, per season, whatever the input order', () => {
    expect(episodeRangesBySeason([ep(2, 1), ep(1, 3), ep(1, 1), ep(1, 2), ep(1, 5)])).toEqual([
      { season: 1, ranges: ['E1-E3', 'E5'] },
      { season: 2, ranges: ['E1'] },
    ]);
  });

  it('ignores medias without episode numbers', () => {
    expect(episodeRangesBySeason([{ seasonNumber: null, episodeNumber: null }])).toEqual([]);
  });

  it('formats seasons for the web with zero padding', () => {
    expect(
      formatSeasonRanges([
        { season: 1, ranges: ['E1-E3'] },
        { season: 10, ranges: ['E2'] },
      ]),
    ).toBe('S01 E1-E3 · S10 E2');
  });
});

describe('groupRequests', () => {
  const SHOW = { imdbId: 'tt100', title: 'Zeta Show' };

  it('folds every episode of a show into one group and keeps movies apart', () => {
    const groups = groupRequests([
      request({ ...SHOW, season: 1, episode: 2 }, RequestStatus.Pending),
      request({ imdbId: 'tt200', title: 'Alpha Movie' }, RequestStatus.Fulfilled),
      request({ ...SHOW, season: 1, episode: 1 }, RequestStatus.Pending),
    ]);

    expect(groups.map((g) => [g.kind, g.title, g.key])).toEqual([
      ['movie', 'Alpha Movie', groups[0].requests[0].mediaId],
      ['show', 'Zeta Show', 'tt100'],
    ]);
    expect(groups[1].requests.map((r) => r.media!.episodeNumber)).toEqual([1, 2]);
  });

  it('summarizes a show per status, attention-first, with episode ranges', () => {
    const [group] = groupRequests([
      request({ ...SHOW, season: 1, episode: 1 }, RequestStatus.Fulfilled),
      request({ ...SHOW, season: 1, episode: 2 }, RequestStatus.Fulfilled),
      request({ ...SHOW, season: 1, episode: 3 }, RequestStatus.Missing),
      request({ ...SHOW, season: 2, episode: 1 }, RequestStatus.Pending),
    ]);

    expect(group.statuses).toEqual([RequestStatus.Missing, RequestStatus.Pending, RequestStatus.Fulfilled]);
    expect(group.byStatus).toEqual([
      { status: RequestStatus.Missing, count: 1, episodes: [{ season: 1, ranges: ['E3'] }] },
      { status: RequestStatus.Pending, count: 1, episodes: [{ season: 2, ranges: ['E1'] }] },
      { status: RequestStatus.Fulfilled, count: 2, episodes: [{ season: 1, ranges: ['E1-E2'] }] },
    ]);
  });

  it('unions the users across the episodes of a show', () => {
    const [group] = groupRequests([
      request({ ...SHOW, season: 1, episode: 1 }, RequestStatus.Pending, ['bob']),
      request({ ...SHOW, season: 1, episode: 2 }, RequestStatus.Pending, ['alice', 'bob']),
    ]);

    expect(group.users).toEqual(['alice', 'bob']);
  });

  it('keeps two movies sharing a title as distinct groups', () => {
    const groups = groupRequests([
      request({ imdbId: 'tt1', title: 'Dune' }, RequestStatus.Pending),
      request({ imdbId: 'tt2', title: 'Dune' }, RequestStatus.Pending),
    ]);

    expect(groups).toHaveLength(2);
  });

  it('skips requests whose media was not loaded', () => {
    const orphan = { ...request({ imdbId: 'tt1', title: 'X' }, RequestStatus.Pending), media: undefined };

    expect(groupRequests([orphan])).toEqual([]);
  });
});
