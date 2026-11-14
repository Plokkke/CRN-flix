import { escapeHtml, getWebTemplate } from '@crn-flix/design-system';

import { ShelfOverride } from '@/services/database/library';
import {
  filterQuery,
  LIBRARY_SHELF_FILTERS,
  LibraryFilter,
  LibraryRow,
  PAGE_SIZE,
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
  form.chips { display: flex; flex-wrap: wrap; gap: 4px; margin: 6px 0 0 0; }
  form.chips[aria-busy='true'] { opacity: 0.5; pointer-events: none; }
  label.chip { position: relative; margin: 0; font-weight: 400; cursor: pointer; }
  label.chip input { position: absolute; opacity: 0; width: 1px; height: 1px; margin: 0; }
  label.chip span { display: inline-block; padding: 2px 10px; font-size: 12px; border: 1px solid var(--border); border-radius: 999px; color: var(--text-light); background: var(--surface); }
  label.chip input:checked + span { background: var(--accent); border-color: var(--accent); color: #fff; }
  label.chip input:focus-visible + span { outline: 2px solid var(--link); outline-offset: 1px; }
  form.filters { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin: 12px 0 16px 0; }
  form.filters input[type='search'] { width: 220px; padding: 6px 8px; font-size: 13px; }
  form.filters select { width: auto; padding: 6px 8px; font-size: 13px; }
  form.filters button { width: auto; padding: 6px 14px; font-size: 13px; margin: 0; }
  .pager { display: flex; gap: 12px; align-items: center; margin: 12px 0; }
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

/** `auto` hands the title back to the rules; the others are the admin's choice, which prevails. */
const SHARED_CHIPS: [string, string][] = [
  ['auto', 'Auto'],
  ['none', 'Aucune'],
  ['standard', 'Standard'],
  ['kids', 'Kids'],
];

const chip = (type: 'radio' | 'checkbox', name: string, value: string, label: string, checked: boolean): string =>
  `<label class="chip"><input type="${type}" name="${name}" value="${escapeHtml(value)}"${checked ? ' checked' : ''} /><span>${escapeHtml(label)}</span></label>`;

function sharedChips(row: LibraryRow, view: string): string {
  const current = row.choice?.shelf ?? 'auto';
  const chips = SHARED_CHIPS.map(([value, label]) => chip('radio', 'shelf', value, label, current === value)).join('');
  return `<form class="chips" method="POST" action="/admin/library/${encodeURIComponent(row.imdbId)}/shelf" aria-label="Étagère partagée">${view}${chips}</form>`;
}

function personalChips(row: LibraryRow, users: { id: string; name: string }[], view: string): string {
  const granted = new Set(row.personal.map((user) => user.userId));
  const chips = users.map((user) => chip('checkbox', 'userId', user.id, user.name, granted.has(user.id))).join('');
  return `<form class="chips" method="POST" action="/admin/library/${encodeURIComponent(row.imdbId)}/personal" aria-label="Étagères personnelles">${view}${chips}</form>`;
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
    <a href="/admin/library">Réinitialiser</a>
  </form>`;
}

/**
 * The list follows the filters as they change, without reloading the page (the search field
 * keeps its focus): typing waits for a pause, a select applies at once. Only the results are
 * replaced, the address keeps the filters, and a late answer never overwrites a newer one. A
 * chip applies its choice at once and replaces only its own line: scroll, filters and the
 * other lines stay as they are.
 */
const LIVE_LIBRARY_JS = `
  (() => {
    const form = document.querySelector('form.filters');
    if (!form) return;
    let timer = null;
    let pending = null;
    const queryOf = () => {
      const query = new URLSearchParams(new FormData(form));
      [...query.entries()].forEach(([key, value]) => {
        if (!value || (key === 'sort' && value === 'attention')) query.delete(key);
      });
      return query.toString();
    };
    const load = async (url, init, address) => {
      clearTimeout(timer);
      pending?.abort();
      pending = new AbortController();
      try {
        const response = await fetch(url, { ...init, signal: pending.signal });
        if (response.redirected && !response.url.includes('/admin/library')) {
          location.href = response.url;
          return;
        }
        const next = new DOMParser().parseFromString(await response.text(), 'text/html').getElementById('library-results');
        if (next) {
          document.getElementById('library-results').replaceWith(next);
          if (address) history.replaceState(null, '', address);
        }
      } catch (error) {
        if (error.name !== 'AbortError') console.warn('Library:', error);
      }
    };
    const refresh = () => {
      const query = queryOf();
      const url = '/admin/library' + (query ? '?' + query : '');
      return load(url, {}, url);
    };
    const showFlash = (message, error) => {
      const slot = document.getElementById('library-flash');
      slot.replaceChildren();
      if (!message) return;
      const box = document.createElement('div');
      box.className = error ? 'flash error' : 'flash';
      box.textContent = message;
      slot.append(box);
    };
    const apply = async (chips, input) => {
      const body = new URLSearchParams({ view: chips.querySelector('input[name="view"]').value });
      if (input.name === 'shelf') {
        body.set('shelf', input.value);
      } else {
        body.set('userId', input.value);
        body.set('action', input.checked ? 'grant' : 'revoke');
      }
      chips.setAttribute('aria-busy', 'true');
      try {
        const response = await fetch(chips.action, { method: 'POST', body, headers: { Accept: 'application/json' } });
        if (!response.ok || !(response.headers.get('content-type') || '').includes('json')) {
          location.reload();
          return;
        }
        const { message, error, row } = await response.json();
        showFlash(message, error);
        const line = chips.closest('tr');
        if (row && line) {
          const holder = document.createElement('tbody');
          holder.innerHTML = row;
          line.replaceWith(holder.firstElementChild);
        } else {
          chips.removeAttribute('aria-busy');
        }
      } catch (error) {
        console.warn('Library:', error);
        chips.removeAttribute('aria-busy');
      }
    };
    form.addEventListener('input', (event) => {
      if (event.target.name === 'q') {
        clearTimeout(timer);
        timer = setTimeout(refresh, 300);
      }
    });
    form.addEventListener('change', (event) => {
      if (event.target.name !== 'q') refresh();
    });
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      refresh();
    });
    document.addEventListener('change', (event) => {
      const chips = event.target.closest('form.chips');
      if (chips) apply(chips, event.target);
    });
  })();
`;

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

/** One title's line; also sent alone after a chip, which replaces only that line. */
export const libraryRow = (row: LibraryRow, users: { id: string; name: string }[], view: string): string =>
  `<tr data-imdb-id="${escapeHtml(row.imdbId)}"${row.unplaced ? ' class="unplaced"' : ''}>
    <td>${escapeHtml(row.title)}<div class="hint">${TYPE_LABELS[row.section] ?? row.section} · <a href="https://www.imdb.com/title/${encodeURIComponent(row.imdbId)}/">${escapeHtml(row.imdbId)}</a></div></td>
    <td>${computedCell(row)}</td>
    <td>${placementCell(row)}${sharedChips(row, view)}</td>
    <td>${personalChips(row, users, view)}</td>
  </tr>`;

export const viewInput = (filter: LibraryFilter): string =>
  `<input type="hidden" name="view" value="${escapeHtml(filterQuery(filter))}" />`;

export type AdminLibraryParams = {
  serviceName: string;
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
  const view = viewInput(filter);
  const rows = params.rows.map((row) => libraryRow(row, params.users, view)).join('');
  const content = `
    <p><a href="/admin">← Dashboard</a></p>
    <h2>📚 Bibliothèque</h2>
    <p class="hint">Le choix de l’admin fait foi sur les règles. Un titre ajouté à l’étagère personnelle d’un abonné y apparaît sans quitter les étagères partagées.</p>
    ${unplaced > 0 ? `<p><a href="/admin/library?state=unplaced">${pill(`${unplaced} titre(s) sur aucune étagère`, 'warning')}</a></p>` : ''}
    ${filterForm(filter)}
    <div id="library-flash">${flash(params.flashMessage, params.flashError)}</div>
    <div id="library-results">
    <p class="hint">${params.total} titre(s)</p>
    ${pager(filter, params.total)}
    ${
      rows
        ? `<table><thead><tr><th>Titre</th><th>Selon les règles</th><th>Étagère partagée</th><th>Étagères personnelles</th></tr></thead><tbody>${rows}</tbody></table>`
        : '<p class="hint">Aucun titre ne correspond.</p>'
    }
    ${pager(filter, params.total)}
    </div>`;
  return getWebTemplate('Bibliothèque', params.serviceName, content, CSS, LIVE_LIBRARY_JS, 'dark');
};
