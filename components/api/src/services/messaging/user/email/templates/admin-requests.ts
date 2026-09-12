import { formatAge, formatBytes } from '@/helpers/format';
import { IndexerCandidate, RejectReason } from '@/modules/indexer/contract';
import {
  ActionView,
  Dashboard,
  DashboardTab,
  ReleaseLine,
  RequestRowView,
  SOURCING_LABELS,
  SourcingKey,
  SystemTicketView,
  TABS,
  URGENCY_LABELS,
} from '@/services/admin/requests-view';
import { actionDisplayLink, candidateOf } from '@/services/indexer-link';
import { PlanLabel } from '@/services/planner/model';
import { Sourcing } from '@/services/planner/sourcing';
import { episodeRangesBySeason, formatSeasonRanges } from '@/services/request-groups';
import { actionTitle } from '@/services/tickets/presenter';

import { DASHBOARD_LAYOUT_CSS, dashboardJs, executionDetailBlock, executionIndicator } from './dashboard-shared';
import { COLORS, escapeHtml } from './email-styles';
import {
  badge,
  BADGE_CSS,
  externalLink,
  imdbLink,
  indexerLink,
  STATUS_LABELS_FR,
  statusBadge,
  traktLink,
} from './request-widgets';
import { operationForm } from './ticket-controls';

export interface AdminRequestsParams {
  dashboard: Dashboard;
  activeTab: DashboardTab;
  /** Where ticket operations and force forms come back to. */
  returnTo: string;
}

const KIND_LABELS = { movie: 'Film', show: 'Série' } as const;

const SOURCING_CLASS: Record<SourcingKey, string> = {
  [Sourcing.Available]: 'src-available',
  [Sourcing.NonCompliant]: 'src-non-compliant',
  [Sourcing.Unavailable]: 'src-unavailable',
  [Sourcing.NotIndexed]: 'src-not-indexed',
  [Sourcing.NotReferenced]: 'src-not-referenced',
  unknown: 'src-unknown',
};

const urgencyBadge = (label: PlanLabel | null): string =>
  label ? badge(`urg-${label}`, URGENCY_LABELS[label]) : '<span class="muted">—</span>';

const sourcingBadge = (key: SourcingKey, count?: number): string =>
  badge(SOURCING_CLASS[key], SOURCING_LABELS[key], count);

const describeCandidate = (c: IndexerCandidate): string =>
  [c.quality, c.language, c.host, formatBytes(c.sizeBytes)].filter(Boolean).join(' · ');

// --- Banner & tabs ---

const banner = (dashboard: Dashboard): string => {
  const alerts = [
    dashboard.alerts.deadLetters > 0 ? `<span class="alert">☠ ${dashboard.alerts.deadLetters} dead-letter</span>` : '',
    dashboard.alerts.failedDownloads > 0
      ? `<span class="alert">⚠ ${dashboard.alerts.failedDownloads} téléchargement(s) en échec</span>`
      : '',
  ].join('');
  const lastPass = formatAge(dashboard.lastPassAt);
  return `
    <div class="banner">
      <span>Dernière passe planner : <b>${lastPass ? escapeHtml(lastPass) : 'jamais'}</b></span>
      ${alerts}
    </div>`;
};

const tabs = (dashboard: Dashboard, activeTab: DashboardTab): string =>
  `<div class="tabs">${TABS.map(
    ({ key, label }) => `
    <button type="button" class="tab ${key === activeTab ? 'active' : ''}" data-tab="${key}" onclick="selectTab('${key}')">
      ${label} <b>${dashboard.counts[key]}</b>
    </button>`,
  ).join('')}</div>`;

const userFilter = (rows: RequestRowView[]): string => {
  const users = [...new Set(rows.flatMap((r) => r.group.users))].sort();
  return `<select id="user-filter" onchange="applyFilters()"><option value="">Tous les utilisateurs</option>${users
    .map((u) => `<option value="${escapeHtml(u)}">${escapeHtml(u)}</option>`)
    .join('')}</select>`;
};

// --- Rows ---

const situationCell = (row: RequestRowView): string => {
  const sourcing = Object.entries(row.sourcingCounts) as [SourcingKey, number][];
  if (sourcing.length > 0) {
    return sourcing.map(([key, count]) => sourcingBadge(key, row.group.kind === 'show' ? count : undefined)).join(' ');
  }
  return row.group.byStatus
    .map((s) => statusBadge(s.status, STATUS_LABELS_FR[s.status], row.group.kind === 'show' ? s.count : undefined))
    .join(' ');
};

const downloadCell = (row: RequestRowView): string =>
  [
    ...row.actions.map((a) => executionIndicator(a.track, a.execution, actionTitle(a.action))),
    ...row.launches.map((l) => executionIndicator(l.track, l.execution, l.label)),
  ].join(' ');

const rowMeta = (row: RequestRowView): string => {
  const { group } = row;
  const count = group.kind === 'show' ? ` · ${group.requests.length} épisode(s)` : '';
  const links = row.indexerLinks.map(indexerLink).join(' · ');
  return `
    <div class="group-meta">${[KIND_LABELS[group.kind] + count, imdbLink(group.imdbId), traktLink(group.kind, group.traktSlug), links].filter(Boolean).join(' · ')}</div>`;
};

// --- Fold ---

const PROPERTY_REASON: [keyof IndexerCandidate, RejectReason][] = [
  ['quality', RejectReason.QualityNotAllowed],
  ['language', RejectReason.LanguageNotAllowed],
  ['host', RejectReason.HostNotAllowed],
  ['sizeBytes', RejectReason.SizeExceeded],
];

/** Each property of the release; the ones failing the preferences are highlighted, nothing else. */
const releaseProperties = (candidate: IndexerCandidate, reasons: RejectReason[]): string =>
  PROPERTY_REASON.map(([property, reason]) => {
    const value = property === 'sizeBytes' ? formatBytes(candidate.sizeBytes) : String(candidate[property]);
    if (!value) {
      return '';
    }
    return reasons.includes(reason) ? `<span class="non-compliant">${escapeHtml(value)}</span>` : escapeHtml(value);
  })
    .filter(Boolean)
    .join(' · ');

const SCOPE_LABELS = { movie: 'film', episode: 'épisode', season: 'pack saison', series: 'pack série' } as const;

const lineRow = (line: ReleaseLine): string => {
  const { release } = line;
  const eligible = release !== null && release.reasons.length === 0;
  const scope = release
    ? `${SCOPE_LABELS[release.candidate.scope.kind]} <span class="muted">${escapeHtml(release.covers)}</span>`
    : `non couvert <span class="muted">${escapeHtml(line.ranges)}</span>`;
  const properties = release
    ? releaseProperties(release.candidate, release.reasons)
    : `<span class="muted">${escapeHtml(SOURCING_LABELS[line.sourcing ?? 'unknown'].toLowerCase())}</span>`;
  const link = release ? externalLink(release.link, eligible ? 'Télécharger ↗' : 'Télécharger quand même ↗') : '';
  const tracking = release?.execution ? executionIndicator(release.track, release.execution, release.covers) : '';
  return `
  <tr class="${eligible ? '' : 'uncovered'}">
    <td>${urgencyBadge(line.urgency)}</td>
    <td>${scope}</td>
    <td>${properties}</td>
    <td>${escapeHtml(line.ranges)} <span class="muted">(${line.count})</span></td>
    <td>${link}</td>
    <td>${tracking}</td>
  </tr>`;
};

/** The best releases covering the gaps and what nothing eligible covers, urgency first. */
const releasesTable = (row: RequestRowView): string =>
  row.lines.length === 0
    ? '<p class="muted">Rien à combler.</p>'
    : `
  <table class="episodes-table">
    <thead><tr><th>Urgence</th><th>Release</th><th>Caractéristiques</th><th>Comble</th><th>Lien</th><th>Suivi</th></tr></thead>
    <tbody>${row.lines.map(lineRow).join('')}</tbody>
  </table>`;

const actionCard = (view: ActionView, returnTo: string): string => {
  const { action, ticket, ticketView } = view;
  const covered = action.medias ? formatSeasonRanges(episodeRangesBySeason(action.medias)) : '';
  const ops =
    ticket && ticketView ? ticketView.operations.map((op) => operationForm(ticket.id, op, returnTo)).join('') : '';
  return `
    <div class="action-card">
      <div class="action-head">
        <b>${escapeHtml(actionTitle(action))}</b>
        ${badge(`urg-${action.label}`, URGENCY_LABELS[action.label])}
        ${badge('action-status', action.status)}
        ${externalLink(actionDisplayLink(action), 'Télécharger ↗')}
        ${ticket ? `<a href="/admin/tickets/${ticket.id}" onclick="event.stopPropagation()">ticket ↗</a>` : '<span class="muted">sans ticket</span>'}
      </div>
      <div class="muted">${escapeHtml(describeCandidate(candidateOf(action)))}${covered ? ` · couvre ${escapeHtml(covered)}` : ''}</div>
      ${executionDetailBlock(view.track, view.execution)}
      <div class="ops">${ops}</div>
    </div>`;
};

const fold = (row: RequestRowView): string => {
  const analysed = row.findingsAt ? `releases relevées ${formatAge(row.findingsAt)}` : 'jamais analysé par le planner';
  return `
    <div class="fold">
      ${releasesTable(row)}
      ${row.actions.length > 0 ? `<h4>Actions du planner</h4>${row.actions.map((a) => actionCard(a, '__RETURN_TO__')).join('')}` : ''}
      ${row.launches.length > 0 ? `<h4>Lancements manuels</h4>${row.launches.map((l) => executionDetailBlock(l.track, l.execution)).join('')}` : ''}
      <div class="muted small">${escapeHtml(analysed)}</div>
    </div>`;
};

const groupRow = (row: RequestRowView): string => {
  const { group } = row;
  const year = group.year === null ? '' : ` (${group.year})`;
  return `
    <tr class="group-row" data-key="${row.key}" data-tabs="${row.tabs.join(' ')}"
        data-users="${escapeHtml(group.users.join(', '))}" onclick="toggleRow('${row.key}')">
      <td class="c-urgency">${urgencyBadge(row.urgency)}</td>
      <td class="c-title">
        <div class="group-title">${escapeHtml(group.title)}${year}</div>
        ${rowMeta(row)}
      </td>
      <td class="c-situation">${situationCell(row)}</td>
      <td class="c-download">${downloadCell(row)}</td>
      <td class="c-users">${escapeHtml(group.users.join(', ')) || '-'}</td>
    </tr>
    <tr class="fold-row hidden-row" data-parent="${row.key}"><td colspan="5">${fold(row)}</td></tr>`;
};

// --- System tab ---

const systemTicket = ({ ticket, view }: SystemTicketView): string => `
  <a class="ticket-card tone-${view.tone}" href="/admin/tickets/${ticket.id}">
    <div class="ticket-title">${escapeHtml(view.title)}</div>
    <div class="ticket-meta">${escapeHtml(ticket.category)} · ${ticket.attempts} tentative(s) · ${ticket.createdAt.toISOString().slice(0, 16).replace('T', ' ')}</div>
  </a>`;

// --- Section ---

export const adminRequestsSection = ({ dashboard, activeTab, returnTo }: AdminRequestsParams): string => {
  const rows = dashboard.rows.map(groupRow).join('').replaceAll('__RETURN_TO__', escapeHtml(returnTo));
  return `
    ${banner(dashboard)}
    ${tabs(dashboard, activeTab)}
    <div class="filters-row">${userFilter(dashboard.rows)} <span class="muted"><span id="visible-count">0</span> ligne(s)</span></div>
    <div class="table-wrapper" data-panel="rows">
      <table class="requests-table">
        <thead><tr><th>Urgence</th><th>Media</th><th>Situation</th><th>Téléchargement</th><th>Users</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <p class="empty-state hidden-row" id="empty-state">Rien dans cet onglet.</p>
    </div>
    <div data-panel="system" class="hidden-row">
      ${dashboard.systemTickets.length > 0 ? dashboard.systemTickets.map(systemTicket).join('') : '<p class="empty-state">Aucun ticket système.</p>'}
    </div>`;
};

export const ADMIN_REQUESTS_CSS = `
  ${BADGE_CSS}
  ${DASHBOARD_LAYOUT_CSS}
  .banner { background: #22223a; }
  .banner .alert { background: ${COLORS.error}; color: #fff; padding: 3px 10px; border-radius: 4px; font-weight: bold; }
  .tab { background: #2a2a3e; color: #aaa; }
  .tab.active { background: #1e2a3a; color: #fff; border-color: ${COLORS.info}; }
  #user-filter { padding: 6px 12px; border-radius: 4px; border: 1px solid #2a2a3e; background: #22223a; color: #e0e0e0; font-size: 14px; }
  .requests-table th { background: #16162a; color: #ccc; }
  .requests-table td { border-bottom: 1px solid #2a2a3e; }
  .group-row:hover { background: #22223a; }
  .group-meta a { color: ${COLORS.info}; }
  .requests-table code { background: #2a2a3e; padding: 2px 6px; border-radius: 3px; font-size: 12px; color: #ccc; }
  .dl { background: #2a2a3e; }
  .dl.failed { background: ${COLORS.error}; color: #fff; }
  .urg-starved { background: ${COLORS.error}; color: #fff; }
  .urg-needed { background: ${COLORS.orange}; color: #fff; }
  .urg-deferred { background: #555; color: #ddd; }
  .src-available { background: ${COLORS.success}; color: #fff; }
  .src-non-compliant { background: ${COLORS.warning}; color: #000; }
  .src-unavailable { background: ${COLORS.error}; color: #fff; }
  .src-not-indexed { background: #7a4bd6; color: #fff; }
  .src-not-referenced { background: #8a2be2; color: #fff; }
  .src-unknown { background: #444; color: #bbb; }
  .override { background: ${COLORS.info}; color: #fff; }
  .action-status { background: #2a2a3e; color: #ccc; }
  .fold h4 { color: #ccc; }
  .episodes-table th { color: #888; }
  .episodes-table td { border-bottom: 1px solid #22223a; }
  .non-compliant { color: ${COLORS.warning}; font-weight: bold; }
  tr.uncovered td:nth-child(2) { color: #aaa; }
  .action-card { border: 1px solid #2a2a3e; border-radius: 6px; padding: 10px 12px; margin: 6px 0; background: #1e1e33; }
  .action-head { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
  .action-head a { color: ${COLORS.info}; }
  .dl-detail { color: #aaa; }
  .ops { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 8px; }
  .op-form { display: flex; gap: 6px; }
  .op-form input { width: auto; padding: 6px 8px; font-size: 13px; background: #22223a; border-color: #2a2a3e; color: #e0e0e0; }
  .op-form button { width: auto; padding: 6px 12px; font-size: 13px; }
  button.secondary { background: transparent; border: 1px solid #555; color: #aaa; }
  .muted { color: #888; opacity: 1; }
  .empty-state { color: #666; }
  .ticket-card { display: block; padding: 10px 12px; margin: 6px 0; border-left: 4px solid #555; background: #1e1e33; color: #e0e0e0; text-decoration: none; border-radius: 4px; }
  .ticket-card.tone-danger { border-color: ${COLORS.error}; }
  .ticket-card.tone-warning { border-color: ${COLORS.warning}; }
  .ticket-card.tone-info { border-color: ${COLORS.info}; }
  .ticket-card.tone-success { border-color: ${COLORS.success}; }
  .ticket-title { font-weight: bold; }
  .ticket-meta { font-size: 12px; color: #888; }
`;

export const adminRequestsJs = (activeTab: DashboardTab): string =>
  dashboardJs({ activeTab, progressUrl: '/admin/requests/progress' });
