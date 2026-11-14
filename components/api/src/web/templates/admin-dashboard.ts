import { COLORS, escapeHtml, getWebTemplate } from '@crn-flix/design-system';

import { Dashboard, DashboardTab } from '@/services/admin/requests-view';

import { ADMIN_REQUESTS_CSS, adminRequestsJs, adminRequestsSection } from './admin-requests';

interface JobDefinition {
  name: string;
  schedule: string;
}

interface AdminDashboardParams {
  serviceName: string;
  dashboard: Dashboard;
  activeTab: DashboardTab;
  jobs: JobDefinition[];
  flashMessage?: string;
}

const getJobsSection = (jobs: JobDefinition[]): string => {
  const cards = jobs
    .map(
      (job) => `
    <div class="job-card">
      <div class="job-name">${job.name}</div>
      <div class="job-schedule">${job.schedule}</div>
      <form method="POST" action="/admin/jobs/${job.name}">
        <button type="submit" onclick="return confirm('Run ${job.name}?')">Trigger</button>
      </form>
    </div>
  `,
    )
    .join('');

  return `
    <h2>Jobs</h2>
    <div class="jobs-grid">${cards}</div>
  `;
};

export const adminDashboardTemplate = (params: AdminDashboardParams): string => {
  const { serviceName, dashboard, activeTab, jobs, flashMessage } = params;

  const flashHtml = flashMessage ? `<div class="flash-message">${escapeHtml(flashMessage)}</div>` : '';

  const content = `
    ${flashHtml}
    <p><a href="/admin/tickets" style="color: var(--link);">🎫 Tickets</a> · <a href="/admin/announce" style="color: var(--link);">📣 Annonce aux abonnés</a> · <a href="/admin/users" style="color: var(--link);">👥 Comptes</a> · <a href="/admin/policies" style="color: var(--link);">🛡️ Politique</a> · <a href="/admin/library" style="color: var(--link);">📚 Bibliothèque</a> · <a href="/admin/messages" style="color: var(--link);">✉️ Messages</a></p>
    ${getJobsSection(jobs)}
    <h2>Requests</h2>
    ${adminRequestsSection({ dashboard, activeTab, returnTo: `/admin?tab=${activeTab}` })}
    <form method="POST" action="/admin/logout" class="logout-form">
      <button type="submit">Se déconnecter</button>
    </form>
  `;

  const additionalCSS = `
    ${ADMIN_REQUESTS_CSS}
    .container { max-width: 900px; }

    .logout-form {
      margin-top: 40px;
      text-align: right;
    }

    .logout-form button {
      background-color: transparent;
      border: 1px solid var(--border);
      color: var(--text-muted);
      width: auto;
      padding: 8px 16px;
      font-size: 13px;
    }

    h2 {
      color: var(--text);
      margin: 30px 0 15px 0;
      font-size: 20px;
    }

    .flash-message {
      background-color: var(--tone-info-bg);
      padding: 12px 16px;
      border-left: 4px solid ${COLORS.info};
      border-radius: 4px;
      margin-bottom: 20px;
      color: var(--text);
    }

    .jobs-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
      gap: 12px;
    }

    .job-card {
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 16px;
      background: var(--surface-raised);
    }

    .job-name {
      font-weight: bold;
      font-size: 14px;
      color: var(--text);
      margin-bottom: 4px;
    }

    .job-schedule {
      font-size: 13px;
      color: var(--text-muted);
      margin-bottom: 12px;
    }

    .job-card button {
      background-color: ${COLORS.secondary};
      width: auto;
      padding: 8px 16px;
      font-size: 14px;
    }

    #user-filter {
      padding: 6px 12px;
      border-radius: 4px;
      border: 1px solid var(--border);
      background-color: var(--surface-raised);
      color: var(--text);
      font-size: 14px;
      cursor: pointer;
    }

    .requests-table th { background-color: var(--header-bg); color: var(--text-light); }
    .requests-table td { border-bottom: 1px solid var(--border); color: var(--text); }
    .requests-table a { color: var(--link); }
    .requests-table code { background-color: var(--tone-neutral-bg); padding: 2px 6px; border-radius: 3px; font-size: 12px; color: var(--text-light); }
    .requests-table tr.group-row:hover { background-color: var(--surface-raised); }

    .empty-state {
      color: var(--text-muted);
      font-style: italic;
    }

    label { color: var(--text); }
    input { background-color: var(--surface-raised); border-color: var(--border); color: var(--text); }
    input:focus { border-color: ${COLORS.info}; }
    button { background-color: ${COLORS.info}; }
    button:hover { background-color: #1c7ed6; }
  `;

  const additionalJS = adminRequestsJs(activeTab);

  return getWebTemplate(`Admin - ${serviceName}`, serviceName, content, additionalCSS, additionalJS, 'dark');
};
