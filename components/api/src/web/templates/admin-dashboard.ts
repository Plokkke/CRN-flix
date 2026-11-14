import { COLORS, escapeHtml } from '@crn-flix/design-system';

import { Dashboard, DashboardTab } from '@/services/admin/requests-view';
import { adminPage } from '@/web/templates/admin-page';

import { ADMIN_REQUESTS_CSS, adminRequestsJs, adminRequestsSection } from './admin-requests';

interface AdminDashboardParams {
  serviceName: string;
  dashboard: Dashboard;
  activeTab: DashboardTab;
  flashMessage?: string;
}

export const adminDashboardTemplate = (params: AdminDashboardParams): string => {
  const { serviceName, dashboard, activeTab, flashMessage } = params;

  const flashHtml = flashMessage ? `<div class="flash-message">${escapeHtml(flashMessage)}</div>` : '';

  const content = `
    ${flashHtml}
    ${adminRequestsSection({ dashboard, activeTab, returnTo: `/admin?tab=${activeTab}` })}
  `;

  const additionalCSS = `
    ${ADMIN_REQUESTS_CSS}
    .container { max-width: 900px; }

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

  return adminPage({ tab: 'requests' }, `Admin - ${serviceName}`, serviceName, content, additionalCSS, additionalJS);
};
