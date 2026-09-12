import * as _ from 'lodash';

import { RequestEntity, RequestStatus } from '@/services/database/requests';

/** Display order: what still needs attention first. */
export const STATUS_ORDER: RequestStatus[] = [
  RequestStatus.Missing,
  RequestStatus.Pending,
  RequestStatus.Fulfilled,
  RequestStatus.Rejected,
];

export type EpisodeLike = { seasonNumber: number | null; episodeNumber: number | null };

export type SeasonRanges = { season: number; ranges: string[] };

export type StatusSummary = { status: RequestStatus; count: number; episodes: SeasonRanges[] };

/** A movie, or every requested episode of one show, folded into a single line. */
export type RequestGroup = {
  key: string;
  kind: 'movie' | 'show';
  title: string;
  year: number | null;
  imdbId: string;
  traktSlug: string | null;
  statuses: RequestStatus[];
  byStatus: StatusSummary[];
  users: string[];
  requests: RequestEntity[];
};

const byEpisodeOrder = (a: EpisodeLike, b: EpisodeLike): number =>
  (a.seasonNumber ?? 0) - (b.seasonNumber ?? 0) || (a.episodeNumber ?? 0) - (b.episodeNumber ?? 0);

const rangeLabel = (start: number, end: number): string => (start === end ? `E${start}` : `E${start}-E${end}`);

function collapseRanges(numbers: number[]): string[] {
  return numbers
    .reduce<{ start: number; end: number }[]>((runs, n) => {
      const last = runs[runs.length - 1];
      if (last && n === last.end + 1) {
        last.end = n;
      } else {
        runs.push({ start: n, end: n });
      }
      return runs;
    }, [])
    .map((run) => rangeLabel(run.start, run.end));
}

/** Collapses S1E1, S1E2, S1E3, S1E5 into `[{ season: 1, ranges: ['E1-E3', 'E5'] }]`. */
export function episodeRangesBySeason(episodes: EpisodeLike[]): SeasonRanges[] {
  const numbered = episodes.filter((e) => e.seasonNumber !== null && e.episodeNumber !== null).sort(byEpisodeOrder);

  return Object.entries(_.groupBy(numbered, (e) => e.seasonNumber)).map(([season, list]) => ({
    season: Number(season),
    ranges: collapseRanges(list.map((e) => e.episodeNumber!)),
  }));
}

const pad2 = (n: number): string => String(n).padStart(2, '0');

/** `S01 E01-E08 · S02 E01` */
export const formatSeasonRanges = (seasons: SeasonRanges[]): string =>
  seasons.map((s) => `S${pad2(s.season)} ${s.ranges.join(', ')}`).join(' · ');

const usersOf = (requests: RequestEntity[]): string[] =>
  [...new Set(requests.flatMap((r) => r.userRequests?.map((ur) => ur.user?.name ?? 'Unknown') ?? []))].sort();

function summarizeByStatus(requests: RequestEntity[]): StatusSummary[] {
  const byStatus = _.groupBy(requests, (r) => r.status);
  return STATUS_ORDER.filter((status) => byStatus[status]).map((status) => ({
    status,
    count: byStatus[status].length,
    episodes: episodeRangesBySeason(byStatus[status].map((r) => r.media!)),
  }));
}

function buildGroup(requests: RequestEntity[]): RequestGroup {
  const sorted = [...requests].sort((a, b) => byEpisodeOrder(a.media!, b.media!));
  const media = sorted[0].media!;
  const kind = media.type === 'episode' ? 'show' : 'movie';
  const byStatus = summarizeByStatus(sorted);
  return {
    key: kind === 'show' ? media.imdbId : media.id,
    kind,
    title: media.title,
    year: media.year,
    imdbId: media.imdbId,
    traktSlug: media.traktSlug ?? null,
    statuses: byStatus.map((s) => s.status),
    byStatus,
    users: usersOf(sorted),
    requests: sorted,
  };
}

/** One group per movie and per show (all its episodes), sorted by title. */
export function groupRequests(requests: RequestEntity[]): RequestGroup[] {
  const withMedia = requests.filter((r) => r.media);
  const groups = Object.values(
    _.groupBy(withMedia, (r) => (r.media!.type === 'episode' ? `show:${r.media!.imdbId}` : `movie:${r.media!.id}`)),
  ).map(buildGroup);
  return groups.sort((a, b) => a.title.localeCompare(b.title, 'fr', { sensitivity: 'base' }));
}
