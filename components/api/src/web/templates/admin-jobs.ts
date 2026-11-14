import { escapeHtml, LIVE_FORMS_CSS, LIVE_FORMS_JS, liveFlashSlot } from '@crn-flix/design-system';

import { adminPage } from '@/web/templates/admin-page';

export type JobDefinition = { name: string; schedule: string };

const CSS = `
  .container { max-width: 960px; }
  table.jobs { width: 100%; border-collapse: collapse; font-size: 14px; }
  table.jobs th { text-align: left; color: var(--text-muted); font-weight: 600; padding: 6px 8px; border-bottom: 1px solid var(--border); }
  table.jobs td { padding: 4px 8px; border-bottom: 1px solid var(--border-light); vertical-align: middle; }
  table.jobs td.actions { text-align: right; width: 1%; }
  table.jobs button { width: auto; margin: 0; padding: 4px 12px; font-size: 13px; }
  ${LIVE_FORMS_CSS}
`;

const jobRow = (job: JobDefinition): string => `<tr>
    <td><code>${escapeHtml(job.name)}</code></td>
    <td class="hint">${escapeHtml(job.schedule)}</td>
    <td class="actions"><form class="live" method="POST" action="/admin/jobs/${encodeURIComponent(job.name)}"><button type="submit">Lancer</button></form></td>
  </tr>`;

/** Every job the engine runs on its own, to launch now by hand. */
export const adminJobsTemplate = (params: {
  serviceName: string;
  jobs: JobDefinition[];
  flashMessage?: string;
}): string =>
  adminPage(
    { tab: 'system', sub: 'jobs' },
    'Jobs',
    params.serviceName,
    `${liveFlashSlot(params.flashMessage)}
    <p class="hint">Un job lancé ici tourne en arrière-plan ; son résultat est dans les logs.</p>
    <table class="jobs"><thead><tr><th>Job</th><th>Planification</th><th></th></tr></thead>
      <tbody>${params.jobs.map(jobRow).join('')}</tbody></table>`,
    CSS,
    LIVE_FORMS_JS,
  );
