import { escapeHtml, getWebTemplate } from '@crn-flix/design-system';

import { ShelfOverride } from '@/services/database/library';
import {
  filterQuery,
  LIBRARY_SHELF_FILTERS,
  LibraryFilter,
  LibraryRow,
  PAGE_SIZE,
  SHELF_CHOICES,
  SHELF_LABELS,
} from '@/services/library/admin-view';

const TYPE_LABELS: Record<string, string> = { movies: 'Film', series: 'Série' };

const STATE_LABELS: Record<string, string> = {
  unplaced: 'Sur aucune étagère',
  anomaly: 'Anomalie en attente ou tranchée',
  restricted: 'Restreint par les règles',
  imposed: 'Étagère imposée',
  personal: 'Sur une étagère personnelle',
};

const SORT_LABELS: Record<string, string> = {
  attention: 'À traiter d’abord',
  title: 'Titre',
  shelf: 'Étagère',
  rules: 'Selon les règles',
};

const ORIGIN_LABELS: Record<ShelfOverride['origin'], string> = {
  admin: 'choix de l’admin',
  'manual-download': 'téléchargement manuel',
  anomaly: 'ticket d’anomalie',
};

const CSS = `
  .container { max-width: 1200px; }
  .flash { background: var(--tone-info-bg); color: var(--tone-info-text); padding: 12px 16px; border-left: 4px solid var(--tone-info-border); border-radius: 4px; margin-bottom: 16px; }
  .flash.error { background: var(--tone-danger-bg); color: var(--tone-danger-text); border-left-color: var(--tone-danger-border); }
  .hint { font-size: 13px; color: var(--text-muted); }
  table { width: 100%; border-collapse: collapse; font-size: 14px; }
  th { text-align: left; color: var(--text-muted); font-weight: 600; padding: 8px; border-bottom: 1px solid var(--border); }
  td { padding: 8px; border-bottom: 1px solid var(--border-light); vertical-align: top; }
  tr.unplaced td { background: var(--tone-warning-bg); }
  .pill { margin-right: 4px; }
  form.inline { display: flex; gap: 6px; align-items: center; margin: 0 0 6px 0; }
  form.inline select { width: auto; padding: 4px 6px; font-size: 13px; }
  form.inline button { width: auto; padding: 4px 10px; font-size: 13px; margin: 0; }
  form.revoke { display: inline; }
  form.filters { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin: 12px 0 16px 0; }
  form.filters input[type='search'] { width: 220px; padding: 6px 8px; font-size: 13px; }
  form.filters select { width: auto; padding: 6px 8px; font-size: 13px; }
  form.filters button { width: auto; padding: 6px 14px; font-size: 13px; margin: 0; }
  .pager { display: flex; gap: 12px; align-items: center; margin: 12px 0; }
  form.revoke button { width: auto; padding: 0 6px; font-size: 12px; margin: 0 0 0 4px; background: transparent; color: var(--link); border: none; }
`;

const flash = (message?: string, error?: boolean): string =>
  message ? `<div class="flash${error ? ' error' : ''}">${escapeHtml(message)}</div>` : '';

const pill = (label: string, tone: string): string => `<span class="pill tone-${tone}">${escapeHtml(label)}</span>`;

const shelfLabel = (shelf: string): string => SHELF_LABELS[shelf] ?? shelf;

function computedCell(row: LibraryRow): string {
  const reasons = row.computed.reasons.map((reason) => `<div class="hint">${escapeHtml(reason)}</div>`).join('');
  return `${escapeHtml(row.computed.label)}${reasons}`;
}

function placementCell(row: LibraryRow): string {
  const shared = row.shared ? pill(shelfLabel(row.shared), 'success') : pill('Hors étagère partagée', 'warning');
  const choice = row.choice
    ? `<div class="hint">Imposé : ${escapeHtml(shelfLabel(row.choice.shelf))} (${escapeHtml(ORIGIN_LABELS[row.choice.origin])})</div>`
    : '';
  return `${shared}${choice}`;
}

function personalCell(row: LibraryRow, view: string): string {
  if (row.personal.length === 0) {
    return '<span class="hint">—</span>';
  }
  return row.personal
    .map(
      (
        user,
      ) => `<div>${escapeHtml(user.name)}<form class="revoke" method="POST" action="/admin/library/${encodeURIComponent(row.imdbId)}/personal">
        <input type="hidden" name="userId" value="${escapeHtml(user.userId)}" /><input type="hidden" name="action" value="revoke" />${view}
        <button type="submit" title="Retirer de son étagère personnelle">retirer</button></form></div>`,
    )
    .join('');
}

function actionsCell(row: LibraryRow, users: { id: string; name: string }[], view: string): string {
  const current = row.choice?.shelf ?? 'auto';
  const options = [
    `<option value="auto"${current === 'auto' ? ' selected' : ''}>Selon les règles</option>`,
    ...SHELF_CHOICES.map(
      (shelf) =>
        `<option value="${shelf}"${current === shelf ? ' selected' : ''}>${escapeHtml(SHELF_LABELS[shelf])}</option>`,
    ),
  ].join('');
  const candidates = users.filter((user) => !row.personal.some((granted) => granted.userId === user.id));
  const grant = candidates.length
    ? `<form class="inline" method="POST" action="/admin/library/${encodeURIComponent(row.imdbId)}/personal">
        <input type="hidden" name="action" value="grant" />${view}
        <select name="userId" aria-label="Abonné">${candidates.map((user) => `<option value="${escapeHtml(user.id)}">${escapeHtml(user.name)}</option>`).join('')}</select>
        <button type="submit">Ajouter à son étagère</button></form>`
    : '';
  return `<form class="inline" method="POST" action="/admin/library/${encodeURIComponent(row.imdbId)}/shelf">
      ${view}<select name="shelf" aria-label="Étagère partagée">${options}</select><button type="submit">Placer</button></form>${grant}`;
}

const option = (value: string, label: string, current: string | undefined): string =>
  `<option value="${escapeHtml(value)}"${current === value ? ' selected' : ''}>${escapeHtml(label)}</option>`;

const select = (name: string, label: string, all: string, labels: Record<string, string>, current?: string): string =>
  `<select name="${name}" aria-label="${escapeHtml(label)}">${all ? option('', all, current ?? '') : ''}${Object.entries(
    labels,
  )
    .map(([value, text]) => option(value, text, current))
    .join('')}</select>`;

function filterForm(filter: LibraryFilter): string {
  const shelves = Object.fromEntries(
    LIBRARY_SHELF_FILTERS.map((shelf) => [shelf, shelf === 'none' ? 'Hors étagère partagée' : SHELF_LABELS[shelf]]),
  );
  return `<form class="filters" method="GET" action="/admin/library">
    <input type="search" name="q" value="${escapeHtml(filter.q ?? '')}" placeholder="Titre ou tt…" aria-label="Titre" />
    ${select('type', 'Type', 'Films et séries', TYPE_LABELS, filter.type)}
    ${select('shelf', 'Étagère partagée', 'Toutes les étagères', shelves, filter.shelf)}
    ${select('state', 'État', 'Tous les états', STATE_LABELS, filter.state)}
    ${select('sort', 'Tri', '', SORT_LABELS, filter.sort)}
    <button type="submit">Filtrer</button>
    <a href="/admin/library">Réinitialiser</a>
  </form>`;
}

function pager(filter: LibraryFilter, total: number): string {
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  if (pages === 1) {
    return '';
  }
  const link = (page: number, label: string): string =>
    `<a href="/admin/library?${filterQuery(filter, page)}">${label}</a>`;
  return `<div class="pager">${filter.page > 1 ? link(filter.page - 1, '← Précédente') : ''}
    <span class="hint">Page ${filter.page} / ${pages}</span>${filter.page < pages ? link(filter.page + 1, 'Suivante →') : ''}</div>`;
}

export type AdminLibraryParams = {
  serviceName: string;
  layout: string;
  mode: string;
  filter: LibraryFilter;
  /** The page of rows the filter keeps, and how many it keeps in all. */
  rows: LibraryRow[];
  total: number;
  /** Titles on no shelf in the whole store, whatever the filter. */
  unplaced: number;
  users: { id: string; name: string }[];
  flashMessage?: string;
  flashError?: boolean;
};

export const adminLibraryTemplate = (params: AdminLibraryParams): string => {
  const { unplaced, filter } = params;
  const view = `<input type="hidden" name="view" value="${escapeHtml(filterQuery(filter))}" />`;
  const notes = [
    params.layout !== 'shelves'
      ? 'Les étagères ne sont pas actives (LIBRARY_LAYOUT=legacy) : tout le monde voit toute la bibliothèque, les choix ci-dessous serviront à la bascule.'
      : '',
    params.mode !== 'enforce'
      ? `Politique en mode ${params.mode} : les règles ne décident pas encore des étagères.`
      : '',
  ]
    .filter(Boolean)
    .map((note) => `<p class="hint">${escapeHtml(note)}</p>`)
    .join('');
  const rows = params.rows
    .map(
      (row) => `<tr${row.unplaced ? ' class="unplaced"' : ''}>
        <td>${escapeHtml(row.title)}<div class="hint">${TYPE_LABELS[row.section] ?? row.section} · <a href="https://www.imdb.com/title/${encodeURIComponent(row.imdbId)}/">${escapeHtml(row.imdbId)}</a></div></td>
        <td>${computedCell(row)}</td>
        <td>${placementCell(row)}</td>
        <td>${personalCell(row, view)}</td>
        <td>${actionsCell(row, params.users, view)}</td>
      </tr>`,
    )
    .join('');
  const content = `
    ${flash(params.flashMessage, params.flashError)}
    <p><a href="/admin">← Dashboard</a></p>
    <h2>📚 Bibliothèque</h2>
    ${notes}
    <p class="hint">Le choix de l’admin fait foi sur les règles. Un titre ajouté à l’étagère personnelle d’un abonné y apparaît sans quitter les étagères partagées.</p>
    ${unplaced > 0 ? `<p><a href="/admin/library?state=unplaced">${pill(`${unplaced} titre(s) sur aucune étagère`, 'warning')}</a></p>` : ''}
    ${filterForm(filter)}
    <p class="hint">${params.total} titre(s)</p>
    ${pager(filter, params.total)}
    ${
      rows
        ? `<table><thead><tr><th>Titre</th><th>Selon les règles</th><th>Étagère partagée</th><th>Étagères personnelles</th><th>Actions</th></tr></thead><tbody>${rows}</tbody></table>`
        : '<p class="hint">Aucun titre ne correspond.</p>'
    }
    ${pager(filter, params.total)}`;
  return getWebTemplate('Bibliothèque', params.serviceName, content, CSS, '', 'dark');
};
