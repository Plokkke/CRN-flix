import { NamingAuditItemEntity } from '@/services/database/naming-audit';

import { COLORS, escapeHtml, getWebTemplate } from './email-styles';

interface AdminNamingAuditParams {
  serviceName: string;
  runId: string | null;
  items: NamingAuditItemEntity[];
  flashMessage?: string;
}

const isFixable = (item: NamingAuditItemEntity): boolean =>
  item.status === 'pending' && !item.reasons.includes('missing-imdb') && !item.reasons.includes('tmdb-not-found');

const renderReasons = (reasons: string[]): string => {
  if (reasons.length === 0) {
    return '<span class="reason reason-ok">conforming</span>';
  }
  return reasons.map((r) => `<span class="reason">${escapeHtml(r)}</span>`).join(' ');
};

const renderRow = (item: NamingAuditItemEntity): string => {
  const fixable = isFixable(item);
  const groupKey = item.mediaType === 'episode' ? (item.imdbId ?? 'unknown') : 'movies';
  const checkbox = fixable
    ? `<input type="checkbox" class="item-checkbox" data-group="${escapeHtml(groupKey)}" name="itemIds" value="${item.id}" />`
    : '<span class="not-fixable" title="Cannot rename automatically (missing canonical metadata)">—</span>';

  return `
    <tr data-status="${escapeHtml(item.status)}" data-type="${escapeHtml(item.mediaType)}" data-fixable="${fixable ? '1' : '0'}" data-group="${escapeHtml(groupKey)}">
      <td class="select-cell">${checkbox}</td>
      <td><span class="status status-${escapeHtml(item.status)}">${escapeHtml(item.status)}</span></td>
      <td class="path-cell"><code>${escapeHtml(item.currentPath)}</code></td>
      <td class="path-cell"><code>${escapeHtml(item.expectedPath)}</code></td>
      <td>${renderReasons(item.reasons)}</td>
      <td>${item.error ? `<span class="error-msg">${escapeHtml(item.error)}</span>` : ''}</td>
    </tr>
  `;
};

const renderTable = (items: NamingAuditItemEntity[]): string => `
  <div class="table-wrapper">
    <table class="audit-table">
      <thead>
        <tr>
          <th></th>
          <th>Status</th>
          <th>Current path</th>
          <th>Expected path</th>
          <th>Reasons</th>
          <th>Error</th>
        </tr>
      </thead>
      <tbody>${items.map(renderRow).join('')}</tbody>
    </table>
  </div>
`;

type SeriesGroup = {
  imdbId: string;
  title: string;
  items: NamingAuditItemEntity[];
};

const extractTitleFromPath = (filePath: string): string | null => {
  const match = filePath.match(/\/series\/([^/]+)\//);
  return match ? match[1] : null;
};

const groupBySeries = (items: NamingAuditItemEntity[]): SeriesGroup[] => {
  const groups = new Map<string, SeriesGroup>();
  for (const item of items) {
    if (item.mediaType !== 'episode') {
      continue;
    }
    const key = item.imdbId ?? 'unknown';
    if (!groups.has(key)) {
      groups.set(key, {
        imdbId: key,
        title: item.englishTitle ?? extractTitleFromPath(item.currentPath) ?? key,
        items: [],
      });
    }
    groups.get(key)!.items.push(item);
  }
  return [...groups.values()].sort((a, b) => a.title.localeCompare(b.title));
};

const groupSummary = (items: NamingAuditItemEntity[]): string => {
  const counts = items.reduce(
    (acc, item) => {
      acc[item.status] = (acc[item.status] ?? 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );
  const fixable = items.filter(isFixable).length;
  return `${items.length} items — pending: ${counts.pending ?? 0}, conforming: ${counts.conforming ?? 0}, applied: ${counts.applied ?? 0}, failed: ${counts.failed ?? 0}, fixable: ${fixable}`;
};

const renderSeriesGroup = (group: SeriesGroup): string => {
  const groupKey = escapeHtml(group.imdbId);
  return `
    <details class="series-group" open data-group="${groupKey}">
      <summary class="series-header">
        <span class="series-toggle"></span>
        <label class="group-select" onclick="event.stopPropagation()">
          <input type="checkbox" class="group-checkbox" data-group="${groupKey}" onchange="toggleGroup('${groupKey}', this.checked)" />
          <span>select all fixable</span>
        </label>
        <span class="series-title">${escapeHtml(group.title)}</span>
        <code class="series-imdb">${groupKey}</code>
        <span class="series-summary">${escapeHtml(groupSummary(group.items))}</span>
      </summary>
      ${renderTable(group.items)}
    </details>
  `;
};

const renderMoviesSection = (items: NamingAuditItemEntity[]): string => {
  if (items.length === 0) {
    return '';
  }
  return `
    <details class="series-group" open data-group="movies">
      <summary class="series-header">
        <span class="series-toggle"></span>
        <label class="group-select" onclick="event.stopPropagation()">
          <input type="checkbox" class="group-checkbox" data-group="movies" onchange="toggleGroup('movies', this.checked)" />
          <span>select all fixable</span>
        </label>
        <span class="series-title">Movies</span>
        <span class="series-summary">${escapeHtml(groupSummary(items))}</span>
      </summary>
      ${renderTable(items)}
    </details>
  `;
};

export const adminNamingAuditTemplate = (params: AdminNamingAuditParams): string => {
  const { serviceName, runId, items, flashMessage } = params;

  const flashHtml = flashMessage ? `<div class="flash-message">${escapeHtml(flashMessage)}</div>` : '';

  const movies = items.filter((i) => i.mediaType === 'movie');
  const seriesGroups = groupBySeries(items);

  const totals = items.reduce(
    (acc, item) => {
      acc[item.status] = (acc[item.status] ?? 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );

  const summary = runId
    ? `Run <code>${escapeHtml(runId)}</code> — pending: ${totals.pending ?? 0}, conforming: ${totals.conforming ?? 0}, applied: ${totals.applied ?? 0}, failed: ${totals.failed ?? 0} (${movies.length} movies, ${seriesGroups.length} series)`
    : 'No audit run yet — trigger <code>naming-audit</code> from the dashboard.';

  const content = `
    ${flashHtml}
    <p><a href="/admin">&larr; Back to dashboard</a></p>
    <h2>Naming audit</h2>
    <p class="summary">${summary}</p>

    <form method="POST" action="/admin/jobs/naming-audit" class="trigger-form">
      <button type="submit" onclick="return confirm('Run a fresh naming audit? This will scan all assets.')">Run new audit</button>
    </form>

    <form method="POST" action="/admin/naming-audit/apply" id="audit-form" onsubmit="return confirmApply()">
      <div class="audit-toolbar">
        <div class="filter-group">
          <label>Status:
            <select id="status-filter" onchange="applyFilters()">
              <option value="">All</option>
              <option value="pending" selected>pending</option>
              <option value="conforming">conforming</option>
              <option value="applied">applied</option>
              <option value="failed">failed</option>
            </select>
          </label>
          <label>Fixable only:
            <input type="checkbox" id="fixable-filter" checked onchange="applyFilters()" />
          </label>
        </div>
        <div class="bulk-actions">
          <button type="button" onclick="expandAll(true)">Expand all</button>
          <button type="button" onclick="expandAll(false)">Collapse all</button>
          <button type="button" onclick="selectAllVisible(true)">Select all visible</button>
          <button type="button" onclick="selectAllVisible(false)">Deselect all</button>
          <span class="selected-count"><span id="selected-count">0</span> selected</span>
          <button type="submit" class="apply-btn">Apply selected</button>
        </div>
      </div>

      ${renderMoviesSection(movies)}
      ${seriesGroups.map(renderSeriesGroup).join('')}
    </form>
  `;

  const additionalCSS = `
    .container { max-width: 1500px; background-color: #1a1a2e; color: #e0e0e0; }
    body { background-color: #0f0f1a; color: #e0e0e0; }
    .header { background-color: #16162a; }
    h2 { color: #e0e0e0; margin: 20px 0 12px 0; }

    .flash-message {
      background-color: #1e2a3a;
      padding: 12px 16px;
      border-left: 4px solid ${COLORS.info};
      border-radius: 4px;
      margin-bottom: 20px;
    }

    .summary { color: #aaa; margin-bottom: 16px; }
    .summary code { background: #2a2a3e; padding: 2px 6px; border-radius: 3px; }

    .trigger-form { margin-bottom: 24px; }
    .trigger-form button { width: auto; padding: 8px 16px; background: ${COLORS.info}; }

    .audit-toolbar {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 16px;
      margin-bottom: 16px;
      flex-wrap: wrap;
      padding: 12px;
      background: #22223a;
      border-radius: 6px;
      position: sticky;
      top: 0;
      z-index: 10;
    }

    .filter-group { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; }
    .filter-group label { display: inline-flex; align-items: center; gap: 6px; color: #ccc; font-size: 13px; }
    .filter-group select, .filter-group input[type=checkbox] { background: #1a1a2e; color: #e0e0e0; border: 1px solid #2a2a3e; padding: 4px 8px; border-radius: 4px; }

    .bulk-actions { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
    .bulk-actions button { width: auto; padding: 6px 12px; font-size: 13px; background: ${COLORS.secondary}; }
    .bulk-actions .apply-btn { background: ${COLORS.success}; font-weight: bold; }
    .selected-count { color: #aaa; font-size: 13px; padding: 0 8px; }

    .series-group {
      margin-bottom: 12px;
      border: 1px solid #2a2a3e;
      border-radius: 6px;
      background: #1e1e30;
    }
    .series-group[data-empty="1"] { display: none; }

    .series-header {
      cursor: pointer;
      list-style: none;
      padding: 10px 14px;
      display: flex;
      align-items: center;
      gap: 12px;
      flex-wrap: wrap;
      background: #22223a;
      border-radius: 6px;
    }
    .series-header::-webkit-details-marker { display: none; }
    .series-toggle { width: 14px; color: #888; }
    .series-toggle::before { content: '▶'; }
    details[open] .series-toggle::before { content: '▼'; }

    .group-select { display: inline-flex; align-items: center; gap: 6px; cursor: pointer; color: #ccc; font-size: 12px; padding: 4px 8px; background: #2a2a3e; border-radius: 4px; }
    .group-select input { margin: 0; }

    .series-title { font-weight: bold; color: #e0e0e0; }
    .series-imdb { background: #2a2a3e; color: #ccc; padding: 2px 6px; border-radius: 3px; font-size: 11px; }
    .series-summary { color: #888; font-size: 12px; margin-left: auto; }

    .table-wrapper { overflow-x: auto; padding: 0 8px 8px; }
    .audit-table { width: 100%; border-collapse: collapse; font-size: 12px; }
    .audit-table th { background-color: #16162a; color: #ccc; padding: 6px 10px; text-align: left; white-space: nowrap; }
    .audit-table td { padding: 6px 10px; border-bottom: 1px solid #2a2a3e; vertical-align: top; }
    .audit-table tr:hover { background-color: #22223a; }
    .audit-table tr.hidden-row { display: none; }

    .audit-table code { background: #1a1a2e; padding: 2px 4px; border-radius: 3px; font-size: 11px; word-break: break-all; }
    .path-cell { max-width: 460px; }

    .status { padding: 2px 6px; border-radius: 3px; font-size: 11px; font-weight: bold; }
    .status-pending { background: ${COLORS.warning}; color: #000; }
    .status-conforming { background: ${COLORS.success}; color: #fff; }
    .status-applied { background: #2d7a4f; color: #fff; }
    .status-failed { background: ${COLORS.error}; color: #fff; }

    .reason { display: inline-block; background: #3a2a3e; color: #f0c0a0; padding: 2px 6px; border-radius: 3px; font-size: 11px; margin: 1px; }
    .reason-ok { background: #2a3a2e; color: #a0f0c0; }

    .select-cell { text-align: center; width: 40px; }
    .not-fixable { color: #666; }
    .error-msg { color: ${COLORS.error}; font-size: 11px; }

    button { background-color: ${COLORS.info}; }
    button:hover { opacity: 0.85; }
  `;

  const additionalJS = `
    function allRows() {
      return Array.from(document.querySelectorAll('.audit-table tbody tr'));
    }

    function applyFilters() {
      var status = document.getElementById('status-filter').value;
      var fixableOnly = document.getElementById('fixable-filter').checked;

      allRows().forEach(function(row) {
        var matchStatus = !status || row.dataset.status === status;
        var matchFixable = !fixableOnly || row.dataset.fixable === '1';
        var show = matchStatus && matchFixable;
        row.classList.toggle('hidden-row', !show);
        if (!show) {
          var cb = row.querySelector('input[type=checkbox][name=itemIds]');
          if (cb) cb.checked = false;
        }
      });
      hideEmptyGroups();
      refreshGroupCheckboxes();
      updateSelectedCount();
    }

    function hideEmptyGroups() {
      document.querySelectorAll('.series-group').forEach(function(group) {
        var rows = group.querySelectorAll('.audit-table tbody tr');
        var visible = Array.from(rows).filter(function(r) { return !r.classList.contains('hidden-row'); }).length;
        group.dataset.empty = visible === 0 ? '1' : '0';
      });
    }

    function selectAllVisible(on) {
      allRows().forEach(function(row) {
        if (row.classList.contains('hidden-row')) return;
        var cb = row.querySelector('input[type=checkbox][name=itemIds]');
        if (cb) cb.checked = on;
      });
      refreshGroupCheckboxes();
      updateSelectedCount();
    }

    function toggleGroup(groupKey, on) {
      document.querySelectorAll('.audit-table tbody tr[data-group="' + cssEscape(groupKey) + '"]').forEach(function(row) {
        if (row.classList.contains('hidden-row')) return;
        var cb = row.querySelector('input[type=checkbox][name=itemIds]');
        if (cb) cb.checked = on;
      });
      updateSelectedCount();
    }

    function refreshGroupCheckboxes() {
      document.querySelectorAll('.group-checkbox').forEach(function(gcb) {
        var key = gcb.dataset.group;
        var rows = document.querySelectorAll('.audit-table tbody tr[data-group="' + cssEscape(key) + '"]:not(.hidden-row)');
        var visibleFixableCheckboxes = [];
        rows.forEach(function(r) {
          var cb = r.querySelector('input[type=checkbox][name=itemIds]');
          if (cb) visibleFixableCheckboxes.push(cb);
        });
        if (visibleFixableCheckboxes.length === 0) {
          gcb.checked = false;
          gcb.indeterminate = false;
          return;
        }
        var checkedCount = visibleFixableCheckboxes.filter(function(cb) { return cb.checked; }).length;
        gcb.checked = checkedCount === visibleFixableCheckboxes.length;
        gcb.indeterminate = checkedCount > 0 && checkedCount < visibleFixableCheckboxes.length;
      });
    }

    function expandAll(on) {
      document.querySelectorAll('details.series-group').forEach(function(d) {
        d.open = on;
      });
    }

    function updateSelectedCount() {
      var checked = document.querySelectorAll('input[type=checkbox][name=itemIds]:checked').length;
      var label = document.getElementById('selected-count');
      if (label) label.textContent = checked;
    }

    function confirmApply() {
      var checked = document.querySelectorAll('input[type=checkbox][name=itemIds]:checked').length;
      if (checked === 0) {
        alert('No items selected.');
        return false;
      }
      return confirm('Apply renames on ' + checked + ' item(s)?');
    }

    function cssEscape(s) {
      return s.replace(/(["\\\\])/g, '\\\\$1');
    }

    document.addEventListener('change', function(ev) {
      if (ev.target && ev.target.matches('input[type=checkbox][name=itemIds]')) {
        refreshGroupCheckboxes();
        updateSelectedCount();
      }
    });

    applyFilters();
  `;

  return getWebTemplate(`Naming audit - ${serviceName}`, serviceName, content, additionalCSS, additionalJS);
};
