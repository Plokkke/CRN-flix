import { ExecutionView, PHASE_LABELS } from '@/services/admin/execution';

import { escapeHtml } from './email-styles';

/** Compact indicator on a row: phase and progress. */
export const executionSummary = (execution: ExecutionView): string => {
  const progress =
    execution.phase === 'downloading' && execution.progress !== null ? ` ${Math.round(execution.progress)}%` : '';
  const icon = { proposed: '📋', downloading: '⬇', extracting: '📦', failed: '⚠' }[execution.phase];
  return `${icon} ${escapeHtml(PHASE_LABELS[execution.phase])}${progress}`;
};

/** Full line in a fold: file, progress, speed, remaining time, error. */
export const executionDetail = (execution: ExecutionView): string =>
  escapeHtml(
    [
      PHASE_LABELS[execution.phase],
      execution.fileName,
      execution.phase === 'downloading' && execution.progress !== null ? `${Math.round(execution.progress)}%` : null,
      execution.speed ? `${(execution.speed / 1024 ** 2).toFixed(1)} Mo/s` : null,
      execution.eta ? `reste ${Math.round(execution.eta / 60)} min` : null,
      execution.error ? `erreur : ${execution.error}` : null,
    ]
      .filter(Boolean)
      .join(' · '),
  );

export const executionIndicator = (track: string, execution: ExecutionView, title: string): string =>
  `<span class="dl ${execution.phase === 'failed' ? 'failed' : ''}" data-track="${track}" title="${escapeHtml(title)}">${executionSummary(execution)}</span>`;

export const executionDetailBlock = (track: string, execution: ExecutionView): string =>
  `<div class="dl-detail" data-track="${track}">${executionDetail(execution)}</div>`;

/** Tabs, folds, optional user filter, and the 30s execution polling. Shared by /admin and /me. */
export const dashboardJs = (options: { activeTab: string; progressUrl: string }): string => `
  var activeTab = '${options.activeTab}';
  var expanded = {};
  var PHASES = ${JSON.stringify(PHASE_LABELS)};
  var ICONS = { proposed: '📋', downloading: '⬇', extracting: '📦', failed: '⚠' };

  function selectTab(tab) {
    activeTab = tab;
    var url = new URL(window.location.href);
    url.searchParams.set('tab', tab);
    url.searchParams.delete('message');
    history.replaceState(null, '', url.toString());
    applyFilters();
  }

  function toggleRow(key) {
    expanded[key] = !expanded[key];
    applyFilters();
  }

  function applyFilters() {
    document.querySelectorAll('.tab').forEach(function(btn) {
      btn.classList.toggle('active', btn.dataset.tab === activeTab);
    });
    document.querySelectorAll('[data-panel]').forEach(function(panel) {
      panel.classList.toggle('hidden-row', panel.dataset.panel !== (activeTab === 'system' ? 'system' : 'rows'));
    });

    var userSelect = document.getElementById('user-filter');
    var userFilter = userSelect ? userSelect.value : '';
    var visible = 0;
    document.querySelectorAll('tr.group-row').forEach(function(row) {
      var tabMatch = row.dataset.tabs.split(' ').indexOf(activeTab) !== -1;
      var userMatch = !userFilter || row.dataset.users.split(', ').indexOf(userFilter) !== -1;
      var show = activeTab !== 'system' && tabMatch && userMatch;
      var isExpanded = !!expanded[row.dataset.key];
      row.classList.toggle('hidden-row', !show);
      row.classList.toggle('expanded', isExpanded);
      var fold = document.querySelector('tr.fold-row[data-parent="' + row.dataset.key + '"]');
      if (fold) fold.classList.toggle('hidden-row', !(show && isExpanded));
      if (show) visible++;
    });
    var counter = document.getElementById('visible-count');
    if (counter) counter.textContent = visible;
    var empty = document.getElementById('empty-state');
    if (empty) empty.classList.toggle('hidden-row', activeTab === 'system' || visible > 0);
  }

  function describeExecution(e, detailed) {
    var pct = e.phase === 'downloading' && e.progress !== null ? Math.round(e.progress) + '%' : '';
    if (!detailed) return ICONS[e.phase] + ' ' + PHASES[e.phase] + (pct ? ' ' + pct : '');
    return [PHASES[e.phase], e.fileName, pct, e.speed ? (e.speed / 1048576).toFixed(1) + ' Mo/s' : null,
      e.eta ? 'reste ' + Math.round(e.eta / 60) + ' min' : null, e.error ? 'erreur : ' + e.error : null]
      .filter(Boolean).join(' · ');
  }

  function refreshProgress() {
    fetch('${options.progressUrl}', { credentials: 'same-origin' })
      .then(function(r) { return r.json(); })
      .then(function(map) {
        document.querySelectorAll('[data-track]').forEach(function(el) {
          var e = map[el.dataset.track];
          if (!e) return;
          el.textContent = describeExecution(e, el.classList.contains('dl-detail'));
          if (el.classList.contains('dl')) el.classList.toggle('failed', e.phase === 'failed');
        });
      })
      .catch(function() {});
  }

  applyFilters();
  setInterval(refreshProgress, 30000);
`;

/** Layout rules common to both dashboards; colors come from each page. */
export const DASHBOARD_LAYOUT_CSS = `
  .banner { display: flex; gap: 16px; flex-wrap: wrap; align-items: center; padding: 10px 14px; border-radius: 6px; margin-bottom: 14px; font-size: 13px; }
  .tabs { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 12px; }
  .tab { width: auto; padding: 8px 14px; border: 2px solid transparent; border-radius: 6px; font-size: 14px; }
  .tab b { margin-left: 4px; }
  .filters-row { display: flex; gap: 16px; align-items: center; margin-bottom: 12px; }
  .table-wrapper { overflow-x: auto; }
  .requests-table { width: 100%; border-collapse: collapse; font-size: 14px; }
  .requests-table th { padding: 10px 12px; text-align: left; white-space: nowrap; }
  .requests-table td { padding: 10px 12px; vertical-align: top; }
  .hidden-row, .requests-table tr.hidden-row { display: none; }
  .group-row { cursor: pointer; }
  .group-row .group-title::before { content: '▸ '; font-size: 12px; }
  .group-row.expanded .group-title::before { content: '▾ '; }
  .group-title { font-weight: bold; }
  .group-meta { font-size: 12px; opacity: 0.7; margin-top: 2px; }
  .c-situation .status-badge { margin: 1px 2px; }
  .dl { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 12px; white-space: nowrap; }
  .fold { padding: 6px 0 10px 20px; }
  .fold h4 { margin: 14px 0 6px; font-size: 14px; }
  .episodes-table { width: 100%; font-size: 13px; border-collapse: collapse; }
  .episodes-table th { background: transparent; font-weight: normal; padding: 4px 8px; }
  .episodes-table td { padding: 4px 8px; }
  .dl-detail { font-size: 12px; margin-top: 4px; }
  .muted { opacity: 0.7; }
  .small { font-size: 12px; margin-top: 8px; }
  .empty-state { font-style: italic; opacity: 0.7; }
`;
