export const SEASON_REMAP_CSS = `
  .container { max-width: 1400px; }
  .flash { background: var(--tone-info-bg); color: var(--tone-info-text); padding: 12px 16px; border-left: 4px solid var(--tone-info-border); border-radius: 4px; margin-bottom: 16px; }
  .flash.error { background: var(--tone-danger-bg); color: var(--tone-danger-text); border-left-color: var(--tone-danger-border); }
  .hint { font-size: 13px; color: var(--text-muted); }
  .seasons { display: flex; flex-wrap: wrap; gap: 6px; margin: 12px 0; }
  .seasons a { padding: 4px 12px; border: 1px solid var(--border); border-radius: 999px; font-size: 13px; text-decoration: none; color: var(--text-light); }
  .seasons a.active { background: var(--accent); border-color: var(--accent); color: #fff; }
  .preview-settings { margin: 0 0 16px 0; font-size: 13px; }
  .preview-settings code { font-size: 12px; word-break: break-all; }
  .preview-settings input { width: 280px; padding: 4px 8px; margin: 4px 0 0 8px; font-size: 13px; }
  .remap { display: grid; grid-template-columns: minmax(0, 3fr) minmax(0, 2fr); gap: 24px; align-items: start; }
  @media (max-width: 1000px) { .remap { grid-template-columns: 1fr; } }
  table { width: 100%; border-collapse: collapse; font-size: 14px; }
  th { text-align: left; color: var(--text-muted); font-weight: 600; padding: 6px; border-bottom: 1px solid var(--border); }
  td { padding: 6px; border-bottom: 1px solid var(--border-light); vertical-align: middle; }
  td.name { word-break: break-all; }
  tr.pending td { background: var(--tone-warning-bg); }
  tr.changed td { background: var(--tone-info-bg); }
  form.manual { margin: 0 0 8px 0; }
  tr.target td:first-child { box-shadow: inset 3px 0 0 var(--accent); }
  input.ep { width: 60px; padding: 4px 6px; margin: 0; font-size: 14px; }
  .tag { font-family: monospace; font-size: 13px; white-space: nowrap; }
  td.play { white-space: nowrap; }
  button.link { width: auto; margin: 0 4px 0 0; padding: 2px 8px; font-size: 12px; background: transparent; border: 1px solid var(--border); color: var(--link); }
  .actions { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin: 12px 0; }
  .actions button { width: auto; margin: 0; padding: 8px 16px; }
  .actions button.secondary { background: transparent; border: 1px solid var(--border); color: var(--text-light); }
  #episode-search { width: 100%; padding: 6px 8px; font-size: 14px; margin: 0 0 6px 0; }
  #search-results { list-style: none; padding: 0; margin: 0 0 12px 0; }
  #search-results li { margin: 2px 0; }
  #search-results button { text-align: left; }
  ol.episodes { list-style: none; padding: 0; margin: 0; font-size: 14px; }
  ol.episodes li { padding: 6px 8px; border-left: 4px solid var(--border); margin-bottom: 4px; background: var(--surface); }
  ol.episodes li.covered { border-left-color: var(--tone-success-border); }
  ol.episodes li.missing { border-left-color: var(--tone-warning-border); }
  ol.episodes li.conflict { border-left-color: var(--tone-danger-border); background: var(--tone-danger-bg); }
  ol.episodes .holder { display: block; font-size: 12px; color: var(--text-muted); word-break: break-all; }
  ol.episodes details { font-size: 12px; color: var(--text-light); }
`;

/**
 * Follows the fields as they change: which file each episode is in, across seasons (a conflict
 * blocks the submission), the tag each file will carry, and which lines change. The search fills
 * the line last focused. The play buttons build the file's address on the local preview server,
 * whose base is kept in this browser only.
 */
export const SEASON_REMAP_JS = String.raw`
  (() => {
    const form = document.getElementById('remap-form');
    if (!form) return;
    const data = JSON.parse(document.getElementById('remap-data').textContent);
    const rows = [...form.querySelectorAll('tr[data-file]')];
    const pad = (value) => String(value).padStart(2, '0');
    const key = (season, episode) => 'S' + pad(season) + 'E' + pad(episode);
    const input = (row, name) => row.querySelector('input[name="' + name + '"]');
    const tagOf = (row) => {
      const raw = input(row, 'season').value.trim();
      const season = Number(raw);
      const start = Number(input(row, 'start').value);
      const end = Number(input(row, 'end').value) || start;
      const valid = raw !== '' && Number.isInteger(season) && season >= 0 && start >= 1 && end >= start;
      return valid ? { season, start, end } : null;
    };
    const conflictsSlot = document.createElement('span');
    conflictsSlot.className = 'hint';
    form.querySelector('.actions').append(conflictsSlot);

    const update = () => {
      const holders = new Map();
      const claim = (tag, name) => {
        for (let episode = tag.start; episode <= tag.end; episode++) {
          const id = key(tag.season, episode);
          holders.set(id, [...(holders.get(id) || []), name]);
        }
      };
      data.others.forEach((other) => claim(other, other.name));
      rows.forEach((row) => {
        const tag = tagOf(row);
        row.querySelector('.tag.next').textContent = tag
          ? key(tag.season, tag.start) + (tag.end > tag.start ? '-E' + pad(tag.end) : '')
          : '—';
        row.classList.toggle('changed', (tag ? tag.season + ':' + tag.start + '-' + tag.end : '') !== row.dataset.initial);
        if (tag) claim(tag, row.dataset.name);
      });
      const conflicts = [...holders.entries()].filter(([, names]) => names.length > 1);
      document.querySelectorAll('ol.episodes li[data-key]').forEach((item) => {
        const files = holders.get(item.dataset.key) || [];
        item.className = files.length > 1 ? 'conflict' : files.length === 1 ? 'covered' : 'missing';
        item.querySelector('.holder').textContent = files.join(' · ') || 'Aucun fichier';
      });
      const submit = form.querySelector('button[type="submit"]');
      submit.disabled = conflicts.length > 0;
      submit.textContent = conflicts.length > 0 ? conflicts.length + ' épisode(s) en conflit' : 'Appliquer';
      conflictsSlot.textContent = conflicts.map(([id, names]) => id + ' : ' + names.join(' · ')).join(' — ');
    };
    form.addEventListener('input', update);

    let target = null;
    let targetField = 'start';
    form.addEventListener('focusin', (event) => {
      const row = event.target.closest('tr[data-file]');
      if (!row) return;
      target = row;
      targetField = event.target.name === 'end' ? 'end' : 'start';
      rows.forEach((other) => other.classList.toggle('target', other === row));
    });
    const assign = (episode) => {
      if (!target) return;
      if (targetField === 'end') {
        input(target, 'end').value = episode.number;
      } else {
        input(target, 'season').value = episode.season;
        input(target, 'start').value = episode.number;
        if (Number(input(target, 'end').value) < episode.number) input(target, 'end').value = '';
      }
      update();
    };
    const normalize = (text) => (text || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    const search = document.getElementById('episode-search');
    const results = document.getElementById('search-results');
    search?.addEventListener('input', () => {
      results.replaceChildren();
      const query = normalize(search.value.trim());
      if (query.length < 2) return;
      data.episodes
        .filter((episode) => normalize(episode.title).includes(query) || normalize(episode.english).includes(query))
        .slice(0, 20)
        .forEach((episode) => {
          const button = document.createElement('button');
          button.type = 'button';
          button.className = 'link';
          button.textContent = episode.key + ' · ' + episode.title;
          button.title = 'Remplit la ligne sélectionnée (le champ « Au » s’il a le focus)';
          button.addEventListener('click', () => assign(episode));
          const item = document.createElement('li');
          item.append(button);
          results.append(item);
        });
    });

    const STORAGE_KEY = 'crn-flix.preview-base';
    const base = document.getElementById('preview-base');
    try {
      base.value = localStorage.getItem(STORAGE_KEY) || '';
    } catch (error) {}
    base.addEventListener('change', () => {
      try {
        localStorage.setItem(STORAGE_KEY, base.value.trim());
      } catch (error) {}
    });
    const addressOf = (row) => {
      const root = base.value.trim().replace(/\/+$/, '');
      return root ? root + '/' + row.dataset.diskPath.split('/').map(encodeURIComponent).join('/') : null;
    };
    const playlist = (row, address) => {
      const blob = new Blob(['#EXTM3U\n#EXTINF:-1,' + row.dataset.name + '\n' + address + '\n'], { type: 'audio/x-mpegurl' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = row.dataset.name.replace(/\.[^.]+$/, '') + '.m3u';
      link.click();
      setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    };
    form.addEventListener('click', async (event) => {
      const button = event.target.closest('button[data-play], button[data-copy]');
      if (!button) return;
      const row = button.closest('tr');
      const address = addressOf(row);
      if (!address) {
        document.querySelector('.preview-settings').open = true;
        base.focus();
        return;
      }
      if (button.hasAttribute('data-play')) {
        playlist(row, address);
        return;
      }
      await navigator.clipboard.writeText(address);
      button.textContent = 'Copié';
      setTimeout(() => (button.textContent = 'Lien'), 1500);
    });

    update();
  })();
`;
