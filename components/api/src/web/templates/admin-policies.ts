import { FieldSpec, PersonCandidate, PolicyKind } from '@crn-flix/contracts';
import { COLORS, escapeHtml } from '@crn-flix/design-system';

import { PolicyRuleEntity, PolicyRuleEntryEntity } from '@/services/database/policy';
import { formFromValues } from '@/services/policy/form';
import { PolicyOverview, RuleCounts } from '@/services/policy/overview';
import { adminPage } from '@/web/templates/admin-page';

export const AUDIENCE_LABELS: Record<string, string> = {
  everyone: 'Tout le monde (refusé partout)',
  kids: 'Étagère kids (ce qu’elle admet)',
  standard: 'Étagère standard (ce qu’elle admet)',
};

const CSS = `
  .container { max-width: 960px; }
  h2 { color: var(--text); margin: 24px 0 12px 0; font-size: 20px; }
  h3 { color: var(--text); margin: 18px 0 8px 0; font-size: 16px; }
  .flash { background: var(--tone-info-bg); padding: 12px 16px; border-left: 4px solid ${COLORS.info}; border-radius: 4px; margin-bottom: 16px; }
  .flash.error { border-left-color: ${COLORS.error}; }
  .hint { font-size: 13px; color: var(--text-muted); }
  .card { background: var(--surface-raised); border: 1px solid var(--border); border-radius: 6px; padding: 12px 14px; margin-bottom: 10px; }
  .row { display: flex; gap: 12px; align-items: baseline; flex-wrap: wrap; }
  .row .grow { flex: 1; min-width: 200px; }
  .badge { font-size: 12px; padding: 2px 8px; border-radius: 10px; background: var(--tone-neutral-bg); color: var(--text-light); }
  .badge.off { color: var(--text-muted); }
  .badge.warn { color: var(--tone-warning-text); }
  .badge.danger { color: var(--tone-danger-text); }
  label { display: block; margin: 10px 0 4px 0; font-size: 14px; }
  input, select, textarea {
    width: 100%; box-sizing: border-box; padding: 8px; border: 1px solid var(--border); border-radius: 4px;
    background: var(--surface); color: var(--text); font-size: 14px; font-family: inherit;
  }
  button { width: auto; padding: 8px 16px; margin-top: 12px; }
  button.danger { background: ${COLORS.error}; }
  details summary { cursor: pointer; margin: 8px 0; }
  ul.titles { columns: 2; font-size: 14px; }
  table.entries { width: 100%; border-collapse: collapse; font-size: 14px; margin-bottom: 12px; }
  table.entries th { text-align: left; color: var(--text-muted); font-weight: 600; padding: 4px 8px; border-bottom: 1px solid var(--border); }
  table.entries td { padding: 3px 8px; border-bottom: 1px solid var(--border-light); vertical-align: middle; }
  table.entries td.actions { text-align: right; width: 1%; white-space: nowrap; }
  table.entries form { margin: 0; }
  table.entries button { margin: 0; padding: 2px 8px; font-size: 12px; background: transparent; color: var(--tone-danger-text); border: 1px solid var(--border); }
`;

const flash = (message?: string, error?: boolean): string =>
  message ? `<div class="flash${error ? ' error' : ''}">${escapeHtml(message)}</div>` : '';

function countsBadges(counts: RuleCounts | undefined): string {
  if (!counts) {
    return '';
  }
  return [
    counts.refused > 0 ? `<span class="badge warn">${counts.refused} refusé(s)</span>` : '',
    counts.undetermined > 0 ? `<span class="badge">${counts.undetermined} indécis</span>` : '',
    counts.invalid > 0 ? `<span class="badge danger">${counts.invalid} invalide(s)</span>` : '',
  ].join(' ');
}

const ruleCard = (rule: PolicyRuleEntity, kind: PolicyKind | undefined, counts: RuleCounts | undefined): string => `
  <div class="card row">
    <span class="grow"><a href="/admin/policies/${escapeHtml(rule.id)}">${escapeHtml(rule.name)}</a>
      <span class="hint">· ${escapeHtml(kind?.name ?? `${rule.kind} (type inconnu)`)} · ${escapeHtml(AUDIENCE_LABELS[rule.audience] ?? rule.audience)}${
        kind?.entries ? ` · ${rule.entryCount} entrée(s)` : ''
      }</span></span>
    ${rule.enabled ? '' : '<span class="badge off">désactivée</span>'}
    ${countsBadges(counts)}
  </div>`;

const option = (value: string, label: string, selected: boolean): string =>
  `<option value="${escapeHtml(value)}"${selected ? ' selected' : ''}>${escapeHtml(label)}</option>`;

const audienceSelect = (audiences: string[], selected: string): string => `
  <label for="audience">Public</label>
  <select id="audience" name="audience">${audiences.map((a) => option(a, AUDIENCE_LABELS[a] ?? a, a === selected)).join('')}</select>`;

const newRuleForm = (kinds: PolicyKind[], audiences: string[]): string => `
  <form class="card" method="POST" action="/admin/policies">
    <h3>Nouvelle règle</h3>
    <label for="name">Nom (« Politique … », montré à l’utilisateur)</label>
    <input id="name" name="name" required maxlength="128" />
    <label for="kind">Type</label>
    <select id="kind" name="kind">${kinds.map((kind) => option(kind.name, `${kind.name} — ${kind.description}`, false)).join('')}</select>
    ${audienceSelect(audiences, 'everyone')}
    <button type="submit">Créer</button>
  </form>`;

function overviewSection(overview: PolicyOverview): string {
  const restricted = overview.restricted
    .map(
      (
        title,
      ) => `<div class="card"><strong>${escapeHtml(title.title)}</strong> <span class="hint">${escapeHtml(title.imdbId)}</span>
        ${title.refusals.map((refusal) => `<div class="hint">${escapeHtml(refusal.ruleName)} : ${escapeHtml(refusal.summary)}</div>`).join('')}</div>`,
    )
    .join('');
  const shelves = Object.entries(overview.shelved)
    .map(
      ([shelf, titles]) => `<details><summary>Étagère ${escapeHtml(shelf)} (${titles.length})</summary>
        <ul class="titles">${titles.map((title) => `<li>${escapeHtml(title.title)}</li>`).join('')}</ul></details>`,
    )
    .join('');
  return `
    <h2>Où vont les titres</h2>
    ${overview.outdated > 0 ? `<p class="hint">${overview.outdated} titre(s) évalué(s) avec d’anciennes règles : réévaluation en cours.</p>` : ''}
    <h3>Restreints (${overview.restricted.length})</h3>
    ${restricted || '<p class="hint">Aucun.</p>'}
    ${shelves}`;
}

export type AdminPoliciesParams = {
  serviceName: string;
  rules: PolicyRuleEntity[];
  kinds: PolicyKind[];
  audiences: string[];
  overview: PolicyOverview;
  flashMessage?: string;
  flashError?: boolean;
};

export const adminPoliciesTemplate = (params: AdminPoliciesParams): string => {
  const kindsByName = new Map(params.kinds.map((kind) => [kind.name, kind]));
  const content = `
    ${flash(params.flashMessage, params.flashError)}
    <p><a href="/admin">← Dashboard</a></p>
    <h2>🛡️ Politique</h2>
    <p class="hint">Une règle « tout le monde » qui ne peut pas trancher laisse passer ; une règle d’étagère qui ne peut pas trancher refuse.</p>
    ${params.rules.map((rule) => ruleCard(rule, kindsByName.get(rule.kind), params.overview.counts.get(rule.id))).join('') || '<p class="hint">Aucune règle.</p>'}
    ${newRuleForm(params.kinds, params.audiences)}
    ${overviewSection(params.overview)}`;
  return adminPage('Politique', params.serviceName, content, CSS);
};

function fieldInput(field: FieldSpec, value: string, prefix: string): string {
  const id = `${prefix}-${field.name}`;
  const name = escapeHtml(field.name);
  const required = field.optional ? '' : ' required';
  const input = (() => {
    switch (field.type) {
      case 'number':
        return `<input type="number" id="${id}" name="${name}" value="${escapeHtml(value)}"${required} />`;
      case 'choice':
        return `<select id="${id}" name="${name}">${(field.options ?? []).map((o) => option(o.value, o.label, o.value === value)).join('')}</select>`;
      case 'text':
        return `<input id="${id}" name="${name}" value="${escapeHtml(value)}"${required} />`;
      default:
        return `<textarea id="${id}" name="${name}" rows="${field.type === 'textarea' ? 3 : 4}"${required}>${escapeHtml(value)}</textarea>`;
    }
  })();
  return `<label for="${id}">${escapeHtml(field.label)}</label>${input}${field.help ? `<div class="hint">${escapeHtml(field.help)}</div>` : ''}`;
}

const fieldInputs = (fields: FieldSpec[], values: unknown, prefix: string): string => {
  const shown = formFromValues(fields, values);
  return fields.map((field) => fieldInput(field, shown[field.name], prefix)).join('');
};

const TMDB_PERSON = /^tmdb:person:(\d+)$/;

/** The entry's page at its source, when its reference tells one. */
function referenceLink(reference: string): string {
  const person = TMDB_PERSON.exec(reference);
  const url = person
    ? `https://www.themoviedb.org/person/${person[1]}`
    : /^tt\d+$/.test(reference)
      ? `https://www.imdb.com/title/${reference}/`
      : null;
  return url ? `<a href="${escapeHtml(url)}">${escapeHtml(reference)}</a>` : escapeHtml(reference);
}

const entryName = (data: Record<string, unknown>): string =>
  String(data.name ?? data.title ?? data.ref ?? data.imdbId ?? 'Entrée');

function entryRow(ruleId: string, entry: PolicyRuleEntryEntity, fields: FieldSpec[]): string {
  const data = (entry.data ?? {}) as Record<string, unknown>;
  const shown = formFromValues(fields, data);
  const extra = fields.map((field) => `<td>${escapeHtml(shown[field.name]).replace(/\n/g, '<br>')}</td>`).join('');
  return `<tr><td>${escapeHtml(entryName(data))}</td><td class="hint">${referenceLink(String(data.ref ?? data.imdbId ?? ''))}</td>${extra}
    <td class="actions"><form class="entry-delete" method="POST" action="/admin/policies/${escapeHtml(ruleId)}/entries/${escapeHtml(entry.id)}/delete">
      <button type="submit" title="Retirer de la règle">Retirer</button></form></td></tr>`;
}

/** One line per entry, sorted by name; removing one keeps the page where it is. */
function entriesTable(ruleId: string, entries: PolicyRuleEntryEntity[], fields: FieldSpec[]): string {
  if (entries.length === 0) {
    return '<p class="hint">Aucune entrée.</p>';
  }
  const sorted = [...entries].sort((a, b) =>
    entryName((a.data ?? {}) as Record<string, unknown>).localeCompare(
      entryName((b.data ?? {}) as Record<string, unknown>),
      'fr',
      { sensitivity: 'base' },
    ),
  );
  const head = ['Nom', 'Référence', ...fields.map((field) => field.label), ''].map(
    (label) => `<th>${escapeHtml(label)}</th>`,
  );
  return `<table class="entries"><thead><tr>${head.join('')}</tr></thead>
    <tbody>${sorted.map((entry) => entryRow(ruleId, entry, fields)).join('')}</tbody></table>`;
}

const ENTRY_DELETE_JS = `
  document.addEventListener('submit', async (event) => {
    const form = event.target.closest('form.entry-delete');
    if (!form) return;
    event.preventDefault();
    const line = form.closest('tr');
    line.style.opacity = '0.4';
    try {
      const response = await fetch(form.action, { method: 'POST' });
      if (!response.ok || response.url.includes('error=1')) throw new Error(String(response.status));
      line.remove();
      const title = document.getElementById('entries-title');
      if (title) title.textContent = 'Entrées (' + document.querySelectorAll('table.entries tbody tr').length + ')';
    } catch (error) {
      console.warn('Entry removal:', error);
      line.style.opacity = '';
    }
  });
`;

const candidateOption = (candidate: PersonCandidate, index: number): string => `
  <label><input type="radio" name="person" value="${escapeHtml(`${candidate.ref}|${candidate.name}`)}"${index === 0 ? ' checked' : ''} />
    ${escapeHtml(candidate.name)} <span class="hint">${escapeHtml(candidate.knownForDepartment ?? '')} · ${escapeHtml(candidate.knownFor.join(', '))}
    · <a href="${escapeHtml(candidate.pageUrl)}" target="_blank" rel="noopener">fiche</a></span></label>`;

function subjectInputs(ruleId: string, kind: PolicyKind, personQuery: string, candidates: PersonCandidate[]): string {
  if (kind.entries?.key === 'person') {
    return `
      <p class="hint">Cherchez la personne, puis choisissez la bonne parmi les homonymes.</p>
      <div class="row"><input class="grow" form="person-search" name="person" value="${escapeHtml(personQuery)}" placeholder="Nom" />
        <button form="person-search" type="submit">Chercher</button></div>
      ${candidates.map(candidateOption).join('') || (personQuery ? '<p class="hint">Personne trouvée.</p>' : '')}`;
  }
  if (kind.entries?.key === 'media') {
    return `<label for="entry-imdbId">IMDb id (tt…)</label><input id="entry-imdbId" name="imdbId" required pattern="tt\\d+" />
      <label for="entry-title">Titre (vide : celui de la source)</label><input id="entry-title" name="title" />`;
  }
  return '';
}

export type AdminPolicyRuleParams = {
  serviceName: string;
  rule: PolicyRuleEntity;
  kind: PolicyKind | null;
  audiences: string[];
  entries: PolicyRuleEntryEntity[];
  personQuery: string;
  candidates: PersonCandidate[];
  flashMessage?: string;
  flashError?: boolean;
};

function entriesSection(params: AdminPolicyRuleParams, kind: PolicyKind): string {
  if (!kind.entries) {
    return '';
  }
  const id = escapeHtml(params.rule.id);
  return `
    <h2 id="entries-title">Entrées (${params.entries.length})</h2>
    ${entriesTable(params.rule.id, params.entries, kind.entries.fields)}
    <form id="person-search" method="GET" action="/admin/policies/${id}"></form>
    <form class="card" method="POST" action="/admin/policies/${id}/entries">
      <h3>Ajouter une entrée</h3>
      ${subjectInputs(params.rule.id, kind, params.personQuery, params.candidates)}
      ${fieldInputs(kind.entries.fields, {}, 'entry')}
      <button type="submit">Ajouter</button>
    </form>`;
}

export const adminPolicyRuleTemplate = (params: AdminPolicyRuleParams): string => {
  const { rule, kind } = params;
  const id = escapeHtml(rule.id);
  const content = `
    ${flash(params.flashMessage, params.flashError)}
    <p><a href="/admin/policies">← Politique</a></p>
    <h2>${escapeHtml(rule.name)}</h2>
    <p class="hint">${escapeHtml(kind ? `${kind.name} — ${kind.description}` : `Type inconnu : ${rule.kind}`)}</p>
    <form class="card" method="POST" action="/admin/policies/${id}">
      <label for="name">Nom</label><input id="name" name="name" required maxlength="128" value="${escapeHtml(rule.name)}" />
      ${audienceSelect(params.audiences, rule.audience)}
      <label for="position">Ordre</label><input type="number" id="position" name="position" value="${rule.position}" />
      <label><input type="checkbox" name="enabled" value="on"${rule.enabled ? ' checked' : ''} /> Active</label>
      ${kind ? fieldInputs(kind.params.fields, rule.params, 'param') : ''}
      <button type="submit">Enregistrer</button>
    </form>
    ${kind ? entriesSection(params, kind) : ''}
    <form method="POST" action="/admin/policies/${id}/delete" onsubmit="return confirm('Supprimer cette règle et ses entrées ?')">
      <button class="danger" type="submit">Supprimer la règle</button>
    </form>`;
  return adminPage(rule.name, params.serviceName, content, CSS, ENTRY_DELETE_JS);
};
