import { RequestStatus } from '@/services/database/requests';
import { formatSeasonRanges, RequestGroup, STATUS_ORDER, StatusSummary } from '@/services/request-groups';

import { escapeHtml } from './email-styles';
import { BADGE_CSS, badge, imdbLink, indexerLink, IndexerLinkView, pad2 } from './request-widgets';

export { IndexerLinkView, STATUS_LABELS_FR } from './request-widgets';

export type RequestGroupsViewOptions = {
  showUsers: boolean;
  /** Admin only: indexer links per imdb id, rendered under the title. */
  indexerLinks?: (imdbId: string) => IndexerLinkView[];
  statusLabel: (status: RequestStatus) => string;
  /** Status filter active on load; null shows everything. */
  defaultStatus: RequestStatus | null;
  emptyMessage: string;
};

const KIND_LABELS: Record<RequestGroup['kind'], string> = { movie: 'Film', show: 'Série' };

const indexerLinksLine = (imdbId: string, opts: RequestGroupsViewOptions): string => {
  const links = opts.indexerLinks?.(imdbId) ?? [];
  return links.length > 0 ? `<div class="group-meta indexers">${links.map(indexerLink).join(' · ')}</div>` : '';
};

const summaryLine = (group: RequestGroup, summary: StatusSummary, opts: RequestGroupsViewOptions): string => `
  <div class="summary-line">
    ${badge(summary.status, opts.statusLabel(summary.status), group.kind === 'show' ? summary.count : undefined)}
    ${group.kind === 'show' ? `<span class="ranges">${formatSeasonRanges(summary.episodes)}</span>` : ''}
  </div>`;

const episodeItems = (group: RequestGroup, opts: RequestGroupsViewOptions): string =>
  group.requests
    .map((request) => {
      const media = request.media!;
      const code = `S${pad2(media.seasonNumber ?? 0)}E${pad2(media.episodeNumber ?? 0)}`;
      return `<li data-status="${request.status}"><code>${code}</code> ${badge(request.status, opts.statusLabel(request.status))}</li>`;
    })
    .join('');

const detailRow = (group: RequestGroup, opts: RequestGroupsViewOptions, columns: number): string =>
  group.kind === 'show'
    ? `<tr class="detail-row hidden-row" data-parent="${group.key}">
        <td colspan="${columns}"><ul class="episodes">${episodeItems(group, opts)}</ul></td>
      </tr>`
    : '';

const groupRow = (group: RequestGroup, opts: RequestGroupsViewOptions): string => {
  const year = group.year === null ? '' : ` (${group.year})`;
  const users = escapeHtml(group.users.join(', '));
  return `
    <tr class="group-row ${group.kind === 'show' ? 'expandable' : ''}" data-key="${group.key}"
        data-statuses="${group.statuses.join(' ')}" data-users="${users}" onclick="toggleGroup('${group.key}')">
      <td>
        <div class="group-title">${escapeHtml(group.title)}${year}</div>
        <div class="group-meta">${KIND_LABELS[group.kind]}${group.kind === 'show' ? ` · ${group.requests.length} épisode(s)` : ''} · ${imdbLink(group.imdbId)}</div>
        ${indexerLinksLine(group.imdbId, opts)}
      </td>
      <td>${group.byStatus.map((summary) => summaryLine(group, summary, opts)).join('')}</td>
      ${opts.showUsers ? `<td>${users || '-'}</td>` : ''}
    </tr>
    ${detailRow(group, opts, opts.showUsers ? 3 : 2)}`;
};

const statusFilters = (opts: RequestGroupsViewOptions): string =>
  STATUS_ORDER.map(
    (status) => `
    <button type="button" class="status-filter status-${status} ${status === opts.defaultStatus ? 'active' : ''}"
            data-status="${status}" onclick="selectStatus('${status}')">${escapeHtml(opts.statusLabel(status))}</button>`,
  ).join('');

const userFilter = (groups: RequestGroup[]): string => {
  const users = [...new Set(groups.flatMap((g) => g.users))].sort();
  const options = users.map((u) => `<option value="${escapeHtml(u)}">${escapeHtml(u)}</option>`).join('');
  return `<select id="user-filter" onchange="applyFilters()"><option value="">All users</option>${options}</select>`;
};

/** Grouped requests table: one row per movie or show, expandable to its episodes. */
export const getRequestGroupsTable = (groups: RequestGroup[], opts: RequestGroupsViewOptions): string => {
  if (groups.length === 0) {
    return `<p class="empty-state">${escapeHtml(opts.emptyMessage)}</p>`;
  }

  return `
    <div class="filters-row">
      <div class="status-filters">${statusFilters(opts)}</div>
      ${opts.showUsers ? userFilter(groups) : ''}
    </div>
    <div class="table-wrapper">
      <table class="requests-table">
        <thead>
          <tr>
            <th>Media</th>
            <th>Statut</th>
            ${opts.showUsers ? '<th>Users</th>' : ''}
          </tr>
        </thead>
        <tbody>${groups.map((group) => groupRow(group, opts)).join('')}</tbody>
      </table>
    </div>`;
};

export const REQUEST_GROUPS_CSS = `
  ${BADGE_CSS}
  .filters-row { display: flex; gap: 16px; margin-bottom: 16px; flex-wrap: wrap; align-items: center; }
  .status-filters { display: flex; gap: 8px; flex-wrap: wrap; }
  .status-filter {
    cursor: pointer;
    transition: all 0.15s;
    width: auto;
    padding: 6px 16px;
    border-radius: 4px;
    font-weight: bold;
    font-size: 14px;
    border: 2px solid transparent;
  }
  .status-filter:not(.active) { opacity: 0.35; }

  .table-wrapper { overflow-x: auto; }
  .requests-table { width: 100%; border-collapse: collapse; font-size: 14px; }
  .requests-table th { padding: 10px 12px; text-align: left; white-space: nowrap; }
  .requests-table td { padding: 10px 12px; vertical-align: top; }
  .requests-table tr.hidden-row { display: none; }
  .group-row.expandable { cursor: pointer; }
  .group-row.expandable .group-title::before { content: '▸ '; font-size: 12px; }
  .group-row.expandable.expanded .group-title::before { content: '▾ '; }
  .group-title { font-weight: bold; }
  .group-meta { font-size: 12px; opacity: 0.7; margin-top: 2px; }
  .summary-line { margin: 2px 0; display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
  .ranges { font-size: 13px; }
  .episodes { list-style: none; margin: 0; padding: 0 0 0 16px; columns: 3; column-gap: 24px; }
  .episodes li { padding: 3px 0; break-inside: avoid; }
  .episodes li.dimmed { opacity: 0.3; }
  @media (max-width: 600px) { .episodes { columns: 1; } }
  .empty-state { font-style: italic; opacity: 0.7; }
`;

export const requestGroupsJs = (opts: RequestGroupsViewOptions): string => `
  var activeStatus = ${opts.defaultStatus ? `'${opts.defaultStatus}'` : 'null'};
  var expanded = {};

  function selectStatus(status) {
    activeStatus = activeStatus === status ? null : status;
    applyFilters();
  }

  function toggleGroup(key) {
    expanded[key] = !expanded[key];
    applyFilters();
  }

  function applyFilters() {
    document.querySelectorAll('.status-filter').forEach(function(btn) {
      btn.classList.toggle('active', btn.dataset.status === activeStatus);
    });

    var userSelect = document.getElementById('user-filter');
    var userFilter = userSelect ? userSelect.value : '';
    var visible = 0;
    document.querySelectorAll('tr.group-row').forEach(function(row) {
      var statusMatch = !activeStatus || row.dataset.statuses.split(' ').indexOf(activeStatus) !== -1;
      var userMatch = !userFilter || row.dataset.users.split(', ').indexOf(userFilter) !== -1;
      var show = statusMatch && userMatch;
      var isExpanded = !!expanded[row.dataset.key];
      row.classList.toggle('hidden-row', !show);
      row.classList.toggle('expanded', isExpanded);
      var detail = document.querySelector('tr.detail-row[data-parent="' + row.dataset.key + '"]');
      if (detail) {
        detail.classList.toggle('hidden-row', !(show && isExpanded));
        detail.querySelectorAll('li').forEach(function(item) {
          item.classList.toggle('dimmed', !!activeStatus && item.dataset.status !== activeStatus);
        });
      }
      if (show) visible++;
    });

    var counter = document.getElementById('visible-count');
    if (counter) counter.textContent = visible;
  }

  applyFilters();
`;
