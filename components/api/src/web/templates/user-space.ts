import { COLORS, escapeHtml, getWebTemplate, RADIUS, TONES } from '@crn-flix/design-system';
import { PlanLabel } from '@crn-flix/planner';

import { formatAge } from '@/helpers/format';
import {
  Dashboard,
  EpisodeView,
  RequestRowView,
  subscriberSourcing,
  SubscriberSourcing,
} from '@/services/admin/requests-view';
import { RequestStatus } from '@/services/database/requests';
import { episodeRangesBySeason, formatSeasonRanges } from '@/services/request-groups';
import { actionTitle } from '@/services/tickets/presenter';

import { DASHBOARD_LAYOUT_CSS, dashboardJs, executionDetailBlock, executionIndicator } from './dashboard-shared';
import { badge, BADGE_CSS, episodeCode, imdbLink, STATUS_LABELS_FR, statusBadge, traktLink } from './request-widgets';

/** What the subscriber is waiting for. */
export type UserSpaceTab = 'pending' | 'available' | 'rejected';

export const USER_SPACE_TABS: { key: UserSpaceTab; label: string }[] = [
  { key: 'pending', label: 'En attente' },
  { key: 'available', label: 'Disponible' },
  { key: 'rejected', label: 'Refusé' },
];

export const parseUserSpaceTab = (tab: string | undefined): UserSpaceTab =>
  USER_SPACE_TABS.some((t) => t.key === tab) ? (tab as UserSpaceTab) : 'pending';

export interface UserSpaceParams {
  serviceName: string;
  userName: string;
  dashboard: Dashboard;
  activeTab: UserSpaceTab;
  basePath: string;
  mediaServerUrl: string;
  flashMessage?: string;
}

/** The only urgency a subscriber sees: what is not for now, veiled, with the reason on hover. */
const DEFERRED_HINT = 'Les prochains épisodes seront mis à disposition au fur et à mesure de votre visionnage.';

const SOURCING_LABELS: Record<SubscriberSourcing, string> = { found: 'Source trouvée', 'not-found': 'Introuvable' };

const TAB_BY_STATUS: Record<RequestStatus, UserSpaceTab> = {
  [RequestStatus.Missing]: 'pending',
  [RequestStatus.Pending]: 'pending',
  [RequestStatus.Fulfilled]: 'available',
  [RequestStatus.Rejected]: 'rejected',
};

const sourcingBadge = (key: SubscriberSourcing, count?: number): string =>
  badge(`sub-${key}`, SOURCING_LABELS[key], count);

/** Deferred episodes keep their state but veiled, so the subscriber knows it is not for now. */
const veiled = (html: string, deferred: boolean): string =>
  deferred ? `<span class="veiled" title="${escapeHtml(DEFERRED_HINT)}">${html}</span>` : html;

const isDeferred = (episode: EpisodeView): boolean => episode.missing && episode.state?.urgency === PlanLabel.Deferred;

const tabsOf = (row: RequestRowView): UserSpaceTab[] => [
  ...new Set(row.episodes.map((e) => TAB_BY_STATUS[e.requestStatus])),
];

const countBy = <K extends string>(items: K[]): Partial<Record<K, number>> =>
  items.reduce<Partial<Record<K, number>>>((acc, k) => ({ ...acc, [k]: (acc[k] ?? 0) + 1 }), {});

const situationCell = (row: RequestRowView): string => {
  const isShow = row.group.kind === 'show';
  const missing = row.episodes.filter((e) => e.missing);
  const allDeferred = missing.length > 0 && missing.every(isDeferred);
  const sourcing = countBy(missing.filter((e) => e.sourcing).map((e) => subscriberSourcing(e.sourcing!)));
  const closed = countBy(row.episodes.filter((e) => !e.missing).map((e) => e.requestStatus));
  return [
    ...(Object.entries(sourcing) as [SubscriberSourcing, number][]).map(([k, n]) =>
      veiled(sourcingBadge(k, isShow ? n : undefined), allDeferred),
    ),
    ...(Object.entries(closed) as [RequestStatus, number][]).map(([k, n]) =>
      statusBadge(k, STATUS_LABELS_FR[k], isShow ? n : undefined),
    ),
  ].join(' ');
};

const episodeRow = (episode: EpisodeView): string => {
  const state = episode.sourcing
    ? sourcingBadge(subscriberSourcing(episode.sourcing))
    : statusBadge(episode.requestStatus, STATUS_LABELS_FR[episode.requestStatus]);
  return `
  <tr>
    <td><code>${episodeCode(episode.media)}</code></td>
    <td>${veiled(state, isDeferred(episode))}</td>
  </tr>`;
};

const fold = (row: RequestRowView): string => {
  const actions = [
    ...row.actions.map(
      (a) => `
      <div class="action-card">
        <b>${escapeHtml(actionTitle(a.action))}</b>
        ${a.action.medias ? `<span class="muted">couvre ${escapeHtml(formatSeasonRanges(episodeRangesBySeason(a.action.medias)))}</span>` : ''}
        ${executionDetailBlock(a.track, a.execution)}
      </div>`,
    ),
    ...row.launches.map((l) => `<div class="action-card">${executionDetailBlock(l.track, l.execution)}</div>`),
  ].join('');
  const analysed = row.plannedAt ? `Situation vérifiée ${formatAge(row.plannedAt)}.` : 'Pas encore analysé.';
  return `
    <div class="fold">
      <table class="episodes-table">
        <thead><tr><th>Épisode</th><th>État</th></tr></thead>
        <tbody>${row.episodes.map(episodeRow).join('')}</tbody>
      </table>
      ${actions ? `<h4>Téléchargements</h4>${actions}` : ''}
      <div class="muted small">${escapeHtml(analysed)}</div>
    </div>`;
};

const groupRow = (row: RequestRowView): string => {
  const { group } = row;
  const isShow = group.kind === 'show';
  const year = group.year === null ? '' : ` (${group.year})`;
  const kind = isShow ? `Série · ${group.requests.length} épisode(s)` : 'Film';
  const meta = [kind, imdbLink(group.imdbId), traktLink(group.kind, group.traktSlug)].filter(Boolean).join(' · ');
  const downloads = [
    ...row.actions.map((a) => executionIndicator(a.track, a.execution, actionTitle(a.action))),
    ...row.launches.map((l) => executionIndicator(l.track, l.execution, l.label)),
  ].join(' ');
  // A movie has nothing to unfold: one line, no click.
  const foldRow = isShow
    ? `<tr class="fold-row hidden-row" data-parent="${row.key}"><td colspan="3">${fold(row)}</td></tr>`
    : '';
  return `
    <tr class="group-row ${isShow ? 'expandable' : ''}" data-key="${row.key}" data-tabs="${tabsOf(row).join(' ')}" data-users=""
        ${isShow ? `onclick="toggleRow('${row.key}')"` : ''}>
      <td class="c-title">
        <div class="group-title">${escapeHtml(group.title)}${year}</div>
        <div class="group-meta">${meta}</div>
      </td>
      <td class="c-situation">${situationCell(row)}</td>
      <td class="c-download">${downloads}</td>
    </tr>
    ${foldRow}`;
};

const tabsBar = (dashboard: Dashboard, activeTab: UserSpaceTab): string => {
  const counts = countBy(dashboard.rows.flatMap(tabsOf));
  return `<div class="tabs">${USER_SPACE_TABS.map(
    ({ key, label }) =>
      `<button type="button" class="tab ${key === activeTab ? 'active' : ''}" data-tab="${key}" onclick="selectTab('${key}')">${label} <b>${counts[key] ?? 0}</b></button>`,
  ).join('')}</div>`;
};

const ADDITIONAL_CSS = `
  ${BADGE_CSS}
  ${DASHBOARD_LAYOUT_CSS}
  .container { max-width: 900px; }
  h2 { margin: 30px 0 15px 0; font-size: 20px; }
  .flash-message { background-color: ${TONES.info.bg}; color: ${TONES.info.text}; border: 1px solid ${TONES.info.border}; padding: 12px 16px; border-radius: ${RADIUS.md}; margin-bottom: 20px; }
  .intro { color: ${COLORS.textLight}; }
  .intro a, .group-meta a { color: ${COLORS.info}; }
  .banner { background: ${COLORS.surfaceMuted}; color: ${COLORS.textMuted}; border: 1px solid ${COLORS.borderLight}; border-radius: ${RADIUS.md}; }
  .tabs { gap: 4px; padding: 4px; background: ${COLORS.borderLight}; border-radius: ${RADIUS.md}; display: inline-flex; }
  .tab { background: transparent; color: ${COLORS.textLight}; border: none; border-radius: ${RADIUS.sm}; font-weight: 500; }
  .tab:hover { background: rgba(255, 255, 255, 0.6); }
  .tab.active { background: ${COLORS.white}; color: ${COLORS.primary}; font-weight: 600; box-shadow: 0 1px 2px rgba(16, 24, 40, 0.08); }
  .tab b { color: ${COLORS.textMuted}; font-weight: 600; }
  .requests-table th { background-color: transparent; color: ${COLORS.textMuted}; font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; border-bottom: 1px solid ${COLORS.border}; }
  .requests-table td { border-bottom: 1px solid ${COLORS.borderLight}; }
  .group-row:hover { background-color: ${COLORS.surfaceMuted}; }
  .requests-table code { background-color: ${COLORS.borderLight}; padding: 2px 6px; border-radius: ${RADIUS.sm}; font-size: 12px; }
  .dl { background: ${TONES.neutral.bg}; color: ${TONES.neutral.text}; border-radius: ${RADIUS.pill}; }
  .dl.failed { background: ${TONES.danger.bg}; color: ${TONES.danger.text}; }
  .veiled { opacity: 0.4; cursor: help; }
  .group-row:not(.expandable) { cursor: default; }
  .group-row:not(.expandable) .group-title::before { content: ''; }
  .sub-found { background: ${TONES.info.bg}; color: ${TONES.info.text}; border-color: ${TONES.info.border}; }
  .sub-not-found { background: ${TONES.neutral.bg}; color: ${TONES.neutral.text}; border-color: ${TONES.neutral.border}; }
  .episodes-table th { color: ${COLORS.textMuted}; }
  .episodes-table td { border-bottom: 1px solid ${COLORS.borderLight}; }
  .action-card { border: 1px solid ${COLORS.border}; border-radius: ${RADIUS.md}; padding: 10px 12px; margin: 6px 0; }
  .dl-detail { color: ${COLORS.textLight}; }
  .logout-form { margin-top: 40px; text-align: right; }
  .logout-form button { background-color: ${COLORS.white}; border: 1px solid ${COLORS.border}; color: ${COLORS.textLight}; width: auto; padding: 8px 16px; font-size: 13px; }
  .logout-form button:hover { background-color: ${COLORS.surfaceMuted}; }
`;

export const userSpaceTemplate = (params: UserSpaceParams): string => {
  const { serviceName, userName, dashboard, activeTab, basePath, mediaServerUrl, flashMessage } = params;
  const lastPass = formatAge(dashboard.lastPassAt);

  const content = `
    ${flashMessage ? `<div class="flash-message">${escapeHtml(flashMessage)}</div>` : ''}
    <h2>Bonjour ${escapeHtml(userName)}</h2>
    <p class="intro">
      Vos demandes, regroupées par série. Cliquez sur une ligne pour le détail par épisode.
      Un état estompé signifie que le contenu est dans votre liste mais pas prioritaire pour l'instant.
      Ce qui est disponible se regarde sur <a href="${escapeHtml(mediaServerUrl)}">${escapeHtml(serviceName)}</a>.
    </p>
    <div class="banner"><span>Dernière vérification : <b>${lastPass ? escapeHtml(lastPass) : 'jamais'}</b></span></div>
    ${tabsBar(dashboard, activeTab)}
    <div class="table-wrapper" data-panel="rows">
      <table class="requests-table">
        <thead><tr><th>Media</th><th>État</th><th>Téléchargement</th></tr></thead>
        <tbody>${dashboard.rows.map(groupRow).join('')}</tbody>
      </table>
      <p class="empty-state hidden-row" id="empty-state">Rien dans cet onglet.</p>
    </div>
    <form method="POST" action="${basePath}/logout" class="logout-form">
      <button type="submit">Se déconnecter</button>
    </form>
  `;

  return getWebTemplate(
    `Mon espace — ${serviceName}`,
    serviceName,
    content,
    ADDITIONAL_CSS,
    dashboardJs({ activeTab, progressUrl: `${basePath}/progress` }),
  );
};
