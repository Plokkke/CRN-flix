import { RequestStatus } from '@/services/database/requests';

import { escapeHtml } from './email-styles';

export const STATUS_LABELS_FR: Record<RequestStatus, string> = {
  [RequestStatus.Missing]: 'Introuvable',
  [RequestStatus.Pending]: 'En cours',
  [RequestStatus.Fulfilled]: 'Disponible',
  [RequestStatus.Rejected]: 'Refusé',
};

/** Human links to one indexer for a media: its page when matched, a manual search otherwise. */
export type IndexerLinkView = { indexerName: string; pageUrl: string | null; searchUrl: string | null };

export const pad2 = (n: number): string => String(n).padStart(2, '0');

export const episodeCode = (media: { seasonNumber: number | null; episodeNumber: number | null }): string =>
  media.seasonNumber === null || media.episodeNumber === null
    ? 'Film'
    : `S${pad2(media.seasonNumber)}E${pad2(media.episodeNumber)}`;

export const badge = (className: string, label: string, count?: number): string =>
  `<span class="status-badge ${className}">${escapeHtml(label)}${count === undefined ? '' : ` <b>${count}</b>`}</span>`;

export const statusBadge = (status: RequestStatus, label: string, count?: number): string =>
  badge(`status-${status}`, label, count);

/** stopPropagation keeps the click from toggling the row it sits in. */
export const externalLink = (href: string, label: string): string =>
  `<a href="${escapeHtml(href)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">${label}</a>`;

export const imdbLink = (imdbId: string): string =>
  `<a class="imdb-link" href="https://www.imdb.com/title/${encodeURIComponent(imdbId)}/" target="_blank" rel="noopener" onclick="event.stopPropagation()"><code>${escapeHtml(imdbId)}</code></a>`;

/** Direct Trakt page; nothing when the slug has not been synced yet. */
export const traktLink = (kind: 'movie' | 'show', slug: string | null): string =>
  slug
    ? externalLink(
        `https://app.trakt.tv/${kind === 'movie' ? 'movies' : 'shows'}/${encodeURIComponent(slug)}`,
        'trakt ↗',
      )
    : '';

/** The indexer's name, linking to the media page when matched, to a manual search otherwise. */
export const indexerLink = (link: IndexerLinkView): string => {
  const href = link.pageUrl ?? link.searchUrl;
  return href ? externalLink(href, escapeHtml(link.indexerName)) : escapeHtml(link.indexerName);
};

export const BADGE_CSS = `
  .status-badge {
    display: inline-block;
    padding: 3px 10px;
    border-radius: 4px;
    font-weight: bold;
    font-size: 12px;
    white-space: nowrap;
  }
  .status-pending { background-color: #ffd700; color: #000; }
  .status-fulfilled { background-color: #32cd32; color: #fff; }
  .status-missing { background-color: #ff8c00; color: #fff; }
  .status-rejected { background-color: #ff4444; color: #fff; }
  .imdb-link { text-decoration: none; }
  .imdb-link:hover code { text-decoration: underline; }
`;
