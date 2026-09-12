import { Dashboard, DashboardTab } from '@/services/admin/requests-view';

import { ADMIN_REQUESTS_CSS, adminRequestsJs, adminRequestsSection } from './admin-requests';
import { COLORS, escapeHtml, getWebTemplate } from './email-styles';

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
    <p><a href="/admin/tickets" style="color: #4dabf7;">🎫 Tickets</a></p>
    ${getJobsSection(jobs)}
    <h2>Requests</h2>
    ${adminRequestsSection({ dashboard, activeTab, returnTo: `/admin?tab=${activeTab}` })}
    <form method="POST" action="/admin/logout" class="logout-form">
      <button type="submit">Se déconnecter</button>
    </form>
  `;

  const additionalCSS = `
    ${ADMIN_REQUESTS_CSS}
    .container { max-width: 900px; background-color: #1a1a2e; color: #e0e0e0; }

    .logout-form {
      margin-top: 40px;
      text-align: right;
    }

    .logout-form button {
      background-color: transparent;
      border: 1px solid #555;
      color: #888;
      width: auto;
      padding: 8px 16px;
      font-size: 13px;
    }

    body { background-color: #0f0f1a; color: #e0e0e0; }

    .header { background-color: #16162a; }

    h2 {
      color: #e0e0e0;
      margin: 30px 0 15px 0;
      font-size: 20px;
    }

    .flash-message {
      background-color: #1e2a3a;
      padding: 12px 16px;
      border-left: 4px solid ${COLORS.info};
      border-radius: 4px;
      margin-bottom: 20px;
      color: #e0e0e0;
    }

    .jobs-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
      gap: 12px;
    }

    .job-card {
      border: 1px solid #2a2a3e;
      border-radius: 8px;
      padding: 16px;
      background: #22223a;
    }

    .job-name {
      font-weight: bold;
      font-size: 14px;
      color: #e0e0e0;
      margin-bottom: 4px;
    }

    .job-schedule {
      font-size: 13px;
      color: #888;
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
      border: 1px solid #2a2a3e;
      background-color: #22223a;
      color: #e0e0e0;
      font-size: 14px;
      cursor: pointer;
    }

    .requests-table th { background-color: #16162a; color: #ccc; }
    .requests-table td { border-bottom: 1px solid #2a2a3e; color: #e0e0e0; }
    .requests-table a { color: ${COLORS.info}; }
    .requests-table code { background-color: #2a2a3e; padding: 2px 6px; border-radius: 3px; font-size: 12px; color: #ccc; }
    .requests-table tr.group-row:hover { background-color: #22223a; }

    .empty-state {
      color: #666;
      font-style: italic;
    }

    label { color: #e0e0e0; }
    input { background-color: #22223a; border-color: #2a2a3e; color: #e0e0e0; }
    input:focus { border-color: ${COLORS.info}; }
    button { background-color: ${COLORS.info}; }
    button:hover { background-color: #1c7ed6; }
  `;

  const additionalJS = adminRequestsJs(activeTab);

  return getWebTemplate(`Admin - ${serviceName}`, serviceName, content, additionalCSS, additionalJS);
};
