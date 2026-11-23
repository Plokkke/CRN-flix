import * as path from 'path';

import { CatalogEpisode } from '@crn-flix/contracts';
import { escapeHtml } from '@crn-flix/design-system';

import { EpisodeFile } from '@/services/library/episode-remap';
import { SeasonPage } from '@/services/library/season-remap';
import { adminPage } from '@/web/templates/admin-page';

const CSS = `
  .container { max-width: 1400px; }
  .flash { background: var(--tone-info-bg); color: var(--tone-info-text); padding: 12px 16px; border-left: 4px solid var(--tone-info-border); border-radius: 4px; margin-bottom: 16px; }
  .flash.error { background: var(--tone-danger-bg); color: var(--tone-danger-text); border-left-color: var(--tone-danger-border); }
  .hint { font-size: 13px; color: var(--text-muted); }
  .seasons { display: flex; flex-wrap: wrap; gap: 6px; margin: 12px 0; }
  .seasons a { padding: 4px 12px; border: 1px solid var(--border); border-radius: 999px; font-size: 13px; text-decoration: none; color: var(--text-light); }
  .seasons a.active { background: var(--accent); border-color: var(--accent); color: #fff; }
  .remap { display: grid; grid-template-columns: minmax(0, 3fr) minmax(0, 2fr); gap: 24px; align-items: start; }
  @media (max-width: 900px) { .remap { grid-template-columns: 1fr; } }
  table { width: 100%; border-collapse: collapse; font-size: 14px; }
  th { text-align: left; color: var(--text-muted); font-weight: 600; padding: 6px; border-bottom: 1px solid var(--border); }
  td { padding: 6px; border-bottom: 1px solid var(--border-light); vertical-align: middle; }
  td.name { word-break: break-all; }
  tr.changed td { background: var(--tone-info-bg); }
  input.ep { width: 64px; padding: 4px 6px; margin: 0; font-size: 14px; }
  .tag { font-family: monospace; font-size: 13px; }
  .actions { display: flex; gap: 8px; margin: 12px 0; }
  .actions button { width: auto; margin: 0; padding: 8px 16px; }
  .actions button.secondary { background: transparent; border: 1px solid var(--border); color: var(--text-light); }
  ol.episodes { list-style: none; padding: 0; margin: 0; font-size: 14px; }
  ol.episodes li { padding: 6px 8px; border-left: 4px solid var(--border); margin-bottom: 4px; background: var(--surface); }
  ol.episodes li.covered { border-left-color: var(--tone-success-border); }
  ol.episodes li.missing { border-left-color: var(--tone-warning-border); }
  ol.episodes li.conflict { border-left-color: var(--tone-danger-border); background: var(--tone-danger-bg); }
  ol.episodes .holder { display: block; font-size: 12px; color: var(--text-muted); word-break: break-all; }
  ol.episodes details { font-size: 12px; color: var(--text-light); }
`;

/**
 * Follows the fields as they change: which file each episode is in (a conflict blocks the
 * submission), the tag each file will carry, and which lines change.
 */
const LIVE_JS = `
  (() => {
    const form = document.getElementById('remap-form');
    if (!form) return;
    const season = String(form.dataset.season).padStart(2, '0');
    const pad = (value) => String(value).padStart(2, '0');
    const rangeOf = (row) => {
      const start = Number(row.querySelector('input[name="start"]').value);
      const end = Number(row.querySelector('input[name="end"]').value) || start;
      return start > 0 && end >= start ? { start, end } : null;
    };
    const update = () => {
      const holders = new Map();
      form.querySelectorAll('tr[data-file]').forEach((row) => {
        const range = rangeOf(row);
        row.querySelector('.tag.next').textContent = range
          ? 'S' + season + 'E' + pad(range.start) + (range.end > range.start ? '-E' + pad(range.end) : '')
          : '—';
        row.classList.toggle('changed', (range ? range.start + '-' + range.end : '') !== row.dataset.initial);
        for (let episode = range?.start ?? 1; range && episode <= range.end; episode++) {
          holders.set(episode, [...(holders.get(episode) || []), row.dataset.name]);
        }
      });
      let conflicts = 0;
      document.querySelectorAll('ol.episodes li[data-number]').forEach((item) => {
        const files = holders.get(Number(item.dataset.number)) || [];
        conflicts += files.length > 1 ? 1 : 0;
        item.className = files.length > 1 ? 'conflict' : files.length === 1 ? 'covered' : 'missing';
        item.querySelector('.holder').textContent = files.join(' · ') || 'Aucun fichier';
      });
      const submit = form.querySelector('button[type="submit"]');
      submit.disabled = conflicts > 0;
      submit.textContent = conflicts > 0 ? conflicts + ' épisode(s) en conflit' : 'Appliquer';
    };
    form.addEventListener('input', update);
    update();
  })();
`;

const flash = (message?: string, error?: boolean): string =>
  message ? `<div class="flash${error ? ' error' : ''}">${escapeHtml(message)}</div>` : '';

const pad = (value: number): string => String(value).padStart(2, '0');

function currentTag(file: EpisodeFile): string {
  if (!file.tag) {
    return 'sans étiquette';
  }
  const { season, start, end } = file.tag;
  return `S${pad(season)}E${pad(start)}${end > start ? `-E${pad(end)}` : ''}`;
}

function fileRow(file: EpisodeFile): string {
  const name = path.basename(file.relativePath);
  const initial = file.tag ? `${file.tag.start}-${file.tag.end}` : '';
  const field = (fieldName: string, value: number | undefined): string =>
    `<input class="ep" type="number" min="1" name="${fieldName}" value="${value ?? ''}" aria-label="${fieldName === 'start' ? 'Premier épisode' : 'Dernier épisode'}" />`;
  return `<tr data-file data-name="${escapeHtml(name)}" data-initial="${initial}">
    <td class="name">${escapeHtml(name)}<div class="hint">${escapeHtml(path.dirname(file.relativePath))}</div>
      <input type="hidden" name="file" value="${escapeHtml(file.relativePath)}" /></td>
    <td class="tag">${currentTag(file)}</td>
    <td>${field('start', file.tag?.start)}</td>
    <td>${field('end', file.tag && file.tag.end > file.tag.start ? file.tag.end : undefined)}</td>
    <td class="tag next"></td>
  </tr>`;
}

function episodeItem(episode: CatalogEpisode): string {
  const title = episode.frenchTitle ?? episode.title ?? 'Sans titre';
  const english =
    episode.frenchTitle && episode.title ? ` <span class="hint">(${escapeHtml(episode.title)})</span>` : '';
  const runtime = episode.runtimeMinutes ? ` <span class="hint">· ${episode.runtimeMinutes} min</span>` : '';
  const overview = episode.overview
    ? `<details><summary>Résumé</summary>${escapeHtml(episode.overview)}</details>`
    : '';
  return `<li data-number="${episode.number}"><strong>E${pad(episode.number)}</strong> ${escapeHtml(title)}${english}${runtime}
    <span class="holder"></span>${overview}</li>`;
}

function seasonTabs(page: SeasonPage): string {
  const base = `/admin/library/${encodeURIComponent(page.imdbId)}/episodes`;
  const tabs = page.seasons
    .map(
      (season) =>
        `<a href="${base}?season=${season}"${season === page.season ? ' class="active"' : ''}>Saison ${season}</a>`,
    )
    .join('');
  return `<nav class="seasons">${tabs}</nav>`;
}

function episodesColumn(page: SeasonPage): string {
  if (page.catalogError) {
    return `<div class="flash error">Épisodes du catalogue indisponibles : ${escapeHtml(page.catalogError)}</div>`;
  }
  if (page.episodes.length === 0) {
    return '<p class="hint">Le catalogue ne connaît pas cette saison.</p>';
  }
  return `<ol class="episodes">${page.episodes.map(episodeItem).join('')}</ol>`;
}

export type AdminSeasonRemapParams = {
  serviceName: string;
  page: SeasonPage;
  flashMessage?: string;
  flashError?: boolean;
};

export const adminSeasonRemapTemplate = ({
  serviceName,
  page,
  flashMessage,
  flashError,
}: AdminSeasonRemapParams): string => {
  const action = `/admin/library/${encodeURIComponent(page.imdbId)}/episodes`;
  const content = `
    <p><a href="/admin/library?type=series">← Bibliothèque</a></p>
    <h2>🎞️ ${escapeHtml(page.title)} — épisodes</h2>
    <p class="hint">Indiquez les épisodes que contient chaque fichier (le dernier seulement s’il en contient plusieurs). Les fichiers sont renommés dans leur dossier, sous-titres compris, puis Jellyfin réanalyse la bibliothèque. Numérotation : celle du catalogue, celle des demandes.</p>
    ${seasonTabs(page)}
    ${flash(flashMessage, flashError)}
    <div class="remap">
      <form id="remap-form" method="POST" action="${action}/apply" data-season="${page.season}">
        <input type="hidden" name="season" value="${page.season}" />
        <table><thead><tr><th>Fichier</th><th>Actuel</th><th>Du</th><th>Au</th><th>Nouveau</th></tr></thead>
        <tbody>${page.files.map(fileRow).join('')}</tbody></table>
        <div class="actions"><button type="submit">Appliquer</button></div>
      </form>
      <section><h3>Épisodes de la saison ${page.season}</h3>${episodesColumn(page)}</section>
    </div>
    <form method="POST" action="${action}/refresh" class="actions">
      <input type="hidden" name="season" value="${page.season}" />
      <button type="submit" class="secondary">Rafraîchir Jellyfin</button>
    </form>`;
  return adminPage({ tab: 'library' }, `${page.title} — épisodes`, serviceName, content, CSS, LIVE_JS);
};
