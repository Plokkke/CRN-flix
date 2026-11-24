import * as path from 'path';

import { CatalogEpisode } from '@crn-flix/contracts';
import { escapeHtml } from '@crn-flix/design-system';

import { episodeKey, EpisodeTag, parseEpisodeTag } from '@/services/library/episode-remap';
import { PageFile, SeasonPage } from '@/services/library/season-remap';
import { adminPage } from '@/web/templates/admin-page';
import { SEASON_REMAP_CSS, SEASON_REMAP_JS } from '@/web/templates/admin-season-remap-assets';

const flash = (message?: string, error?: boolean): string =>
  message ? `<div class="flash${error ? ' error' : ''}">${escapeHtml(message)}</div>` : '';

const tagLabel = (tag: EpisodeTag | null): string =>
  tag
    ? `${episodeKey(tag.season, tag.start)}${tag.end > tag.start ? `-E${String(tag.end).padStart(2, '0')}` : ''}`
    : 'sans étiquette';

const displayTitle = (episode: CatalogEpisode): string => episode.frenchTitle ?? episode.title ?? 'Sans titre';

const field = (name: string, value: number | undefined, label: string, min: number): string =>
  `<input class="ep" type="number" min="${min}" name="${name}" value="${value ?? ''}" aria-label="${label}" />`;

/** What the release name claims, for information only: it is the numbering being corrected. */
const releaseHint = (name: string): string => {
  const tag = parseEpisodeTag(name);
  return tag ? ` (release : ${tagLabel(tag)})` : '';
};

function fileRow(file: PageFile, season: number): string {
  const name = path.basename(file.relativePath);
  const tag = file.tag;
  const initial = tag ? `${tag.season}:${tag.start}-${tag.end}` : '';
  const where = file.pendingFrom ? `En attente · ${file.pendingFrom}` : path.dirname(file.relativePath);
  const current = file.pendingFrom ? `à classer${releaseHint(name)}` : tagLabel(tag);
  return `<tr data-file data-name="${escapeHtml(name)}" data-initial="${initial}" data-disk-path="${escapeHtml(file.diskPath)}"${file.pendingFrom ? ' class="pending"' : ''}>
    <td class="name">${escapeHtml(name)}<div class="hint">${escapeHtml(where)}</div>
      <input type="hidden" name="file" value="${escapeHtml(file.relativePath)}" /></td>
    <td class="tag">${escapeHtml(current)}</td>
    <td>${field('season', tag?.season ?? season, 'Saison', 0)}</td>
    <td>${field('start', tag?.start, 'Premier épisode', 1)}</td>
    <td>${field('end', tag && tag.end > tag.start ? tag.end : undefined, 'Dernier épisode', 1)}</td>
    <td class="tag next"></td>
    <td class="play"><button type="button" class="link" data-play title="Ouvrir dans VLC">▶ VLC</button>
      <button type="button" class="link" data-copy title="Copier le lien">Lien</button></td>
  </tr>`;
}

function manualToggle(page: SeasonPage, action: string): string {
  const [label, next, hint] = page.manual
    ? [
        'Revenir à la numérotation du catalogue',
        'off',
        'Numérotation manuelle : les téléchargements de cette série attendent ici au lieu d’être rangés.',
      ]
    : [
        'Passer en numérotation manuelle',
        'on',
        'Les téléchargements de cette série sont rangés selon le nom de la release.',
      ];
  return `<form method="POST" action="${action}/manual" class="actions manual">
    <input type="hidden" name="manual" value="${next}" /><input type="hidden" name="season" value="${page.season}" />
    <span class="hint">${hint}</span><button type="submit" class="secondary">${label}</button>
  </form>`;
}

function episodeItem(episode: CatalogEpisode): string {
  const english =
    episode.frenchTitle && episode.title ? ` <span class="hint">(${escapeHtml(episode.title)})</span>` : '';
  const runtime = episode.runtimeMinutes ? ` <span class="hint">· ${episode.runtimeMinutes} min</span>` : '';
  const overview = episode.overview
    ? `<details><summary>Résumé</summary>${escapeHtml(episode.overview)}</details>`
    : '';
  return `<li data-key="${episodeKey(episode.season, episode.number)}"><strong>E${String(episode.number).padStart(2, '0')}</strong> ${escapeHtml(displayTitle(episode))}${english}${runtime}
    <span class="holder"></span>${overview}</li>`;
}

function seasonTabs(page: SeasonPage): string {
  const base = `/admin/library/${encodeURIComponent(page.imdbId)}/episodes`;
  const tabs = page.seasons
    .map((season) => {
      const label = season === 0 ? 'Spéciaux' : `Saison ${season}`;
      return `<a href="${base}?season=${season}"${season === page.season ? ' class="active"' : ''}>${label}</a>`;
    })
    .join('');
  return `<nav class="seasons">${tabs}</nav>`;
}

function episodesColumn(page: SeasonPage): string {
  if (page.catalogError) {
    return `<div class="flash error">Épisodes du catalogue indisponibles : ${escapeHtml(page.catalogError)}</div>`;
  }
  const ofSeason = page.episodes.filter((episode) => episode.season === page.season);
  const list = ofSeason.length
    ? `<ol class="episodes">${ofSeason.map(episodeItem).join('')}</ol>`
    : '<p class="hint">Le catalogue ne connaît pas cette saison.</p>';
  return `<input type="search" id="episode-search" placeholder="Chercher un titre dans toute la série…" aria-label="Chercher un épisode" />
    <ul id="search-results"></ul>
    <h3>Épisodes de la saison ${page.season}</h3>${list}`;
}

/** What the live script needs: every episode for the search, the files of other seasons for conflicts. */
function pageData(page: SeasonPage): string {
  const data = {
    episodes: page.episodes.map((episode) => ({
      key: episodeKey(episode.season, episode.number),
      season: episode.season,
      number: episode.number,
      title: displayTitle(episode),
      english: episode.title,
    })),
    others: page.others.flatMap((file) => (file.tag ? [{ name: path.basename(file.relativePath), ...file.tag }] : [])),
  };
  return `<script type="application/json" id="remap-data">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>`;
}

const previewSettings = `<details class="preview-settings"><summary>Lecture des fichiers</summary>
  <p class="hint">Les boutons ▶ VLC lisent le fichier par un serveur HTTP local qui passe par SSH, par exemple :
  <code>rclone serve http :sftp:&lt;dossier du disque sur le serveur&gt; --sftp-ssh "ssh &lt;hôte&gt;" --read-only --addr 127.0.0.1:8765</code>.
  Son adresse est gardée dans ce navigateur seulement.</p>
  <label>Adresse du disque <input type="url" id="preview-base" placeholder="http://127.0.0.1:8765" /></label>
</details>`;

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
    <p class="hint">Indiquez la saison et les épisodes que contient chaque fichier (le dernier seulement s’il en contient plusieurs), dans la numérotation du catalogue. Les fichiers sont renommés dans leur dossier, sous-titres compris, puis Jellyfin réanalyse la bibliothèque.</p>
    ${manualToggle(page, action)}
    ${seasonTabs(page)}
    ${flash(flashMessage, flashError)}
    ${previewSettings}
    <div class="remap">
      <form id="remap-form" method="POST" action="${action}/apply">
        <input type="hidden" name="view" value="${page.season}" />
        <table><thead><tr><th>Fichier</th><th>Actuel</th><th>Saison</th><th>Du</th><th>Au</th><th>Nouveau</th><th></th></tr></thead>
        <tbody>${page.files.map((file) => fileRow(file, page.season)).join('')}</tbody></table>
        <div class="actions"><button type="submit">Appliquer</button></div>
      </form>
      <section>${episodesColumn(page)}</section>
    </div>
    <form method="POST" action="${action}/refresh" class="actions">
      <input type="hidden" name="season" value="${page.season}" />
      <button type="submit" class="secondary">Rafraîchir Jellyfin</button>
    </form>
    ${pageData(page)}`;
  return adminPage(
    { tab: 'library' },
    `${page.title} — épisodes`,
    serviceName,
    content,
    SEASON_REMAP_CSS,
    SEASON_REMAP_JS,
  );
};
