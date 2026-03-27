import { RequestEntity } from '@/services/database/requests';

import { COLORS, getStatusStyle, getWebTemplate } from './email-styles';

interface JobDefinition {
  name: string;
  schedule: string;
}

interface AdminDashboardParams {
  serviceName: string;
  requests: RequestEntity[];
  jobs: JobDefinition[];
  flashMessage?: string;
}

const STATUSES = ['missing', 'pending', 'fulfilled', 'rejected'] as const;

const getMediaLabel = (request: RequestEntity): string => {
  const media = request.media;
  if (!media) {
    return 'Unknown';
  }

  const base = `${media.title} (${media.year})`;
  if (media.type === 'episode' && media.seasonNumber !== null && media.episodeNumber !== null) {
    return `${base} — S${String(media.seasonNumber).padStart(2, '0')}E${String(media.episodeNumber).padStart(2, '0')}`;
  }
  return base;
};

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

const getStatusFilters = (): string => {
  const buttons = STATUSES.map(
    (status) => `
    <button
      type="button"
      class="status-filter status-${status} ${status === 'pending' ? 'active' : ''}"
      data-status="${status}"
      onclick="toggleStatus('${status}')"
    >${status}</button>
  `,
  ).join('');

  return `<div class="status-filters">${buttons}</div>`;
};

const getRequestsSection = (requests: RequestEntity[]): string => {
  if (requests.length === 0) {
    return `
      <h2>Requests (0)</h2>
      <p class="empty-state">No requests yet.</p>
    `;
  }

  const sorted = [...requests].sort((a, b) => {
    const labelA = getMediaLabel(a).toLowerCase();
    const labelB = getMediaLabel(b).toLowerCase();
    return labelA.localeCompare(labelB);
  });

  const rows = sorted
    .map(
      (request) => `
    <tr data-status="${request.status}">
      <td>${request.darkiworldUrl ? `<a href="${request.darkiworldUrl}" target="_blank" rel="noopener">${getMediaLabel(request)}</a>` : getMediaLabel(request)}</td>
      <td>${request.media?.type ?? '-'}</td>
      <td><span style="${getStatusStyle(request.status)}">${request.status}</span></td>
      <td>${request.userRequests?.map((ur) => ur.user?.name ?? 'Unknown').join(', ') ?? '-'}</td>
    </tr>
  `,
    )
    .join('');

  return `
    <h2>Requests (<span id="visible-count">0</span> / ${requests.length})</h2>
    ${getStatusFilters()}
    <div class="table-wrapper">
      <table class="requests-table">
        <thead>
          <tr>
            <th>Media</th>
            <th>Type</th>
            <th>Status</th>
            <th>Users</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
};

export const adminDashboardTemplate = (params: AdminDashboardParams): string => {
  const { serviceName, requests, jobs, flashMessage } = params;

  const flashHtml = flashMessage ? `<div class="flash-message">${flashMessage}</div>` : '';

  const content = `
    ${flashHtml}
    ${getJobsSection(jobs)}
    ${getRequestsSection(requests)}
  `;

  const additionalCSS = `
    .container { max-width: 900px; }

    h2 {
      color: ${COLORS.primary};
      margin: 30px 0 15px 0;
      font-size: 20px;
    }

    .flash-message {
      background-color: #f0f7ff;
      padding: 12px 16px;
      border-left: 4px solid ${COLORS.info};
      border-radius: 4px;
      margin-bottom: 20px;
    }

    .jobs-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
      gap: 12px;
    }

    .job-card {
      border: 1px solid ${COLORS.border};
      border-radius: 8px;
      padding: 16px;
      background: ${COLORS.white};
    }

    .job-name {
      font-weight: bold;
      font-size: 14px;
      color: ${COLORS.primary};
      margin-bottom: 4px;
    }

    .job-schedule {
      font-size: 13px;
      color: ${COLORS.textMuted};
      margin-bottom: 12px;
    }

    .job-card button {
      background-color: ${COLORS.secondary};
      width: auto;
      padding: 8px 16px;
      font-size: 14px;
    }

    .status-filters {
      display: flex;
      gap: 8px;
      margin-bottom: 16px;
      flex-wrap: wrap;
    }

    .status-filter {
      cursor: pointer;
      transition: all 0.15s;
      width: auto;
      padding: 6px 16px;
      border-radius: 4px;
      font-weight: bold;
      font-size: 14px;
      border: 2px solid transparent;
    }

    .status-filter:not(.active) {
      background-color: ${COLORS.border} !important;
      color: ${COLORS.textMuted} !important;
      border-color: ${COLORS.border} !important;
    }

    .status-pending { background-color: ${COLORS.warning}; color: #000; }
    .status-fulfilled { background-color: ${COLORS.success}; color: #fff; }
    .status-missing { background-color: ${COLORS.orange}; color: #fff; }
    .status-rejected { background-color: ${COLORS.error}; color: #fff; }

    .table-wrapper {
      overflow-x: auto;
    }

    .requests-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 14px;
    }

    .requests-table th {
      background-color: ${COLORS.primary};
      color: white;
      padding: 10px 12px;
      text-align: left;
      white-space: nowrap;
    }

    .requests-table td {
      padding: 10px 12px;
      border-bottom: 1px solid ${COLORS.borderLight};
    }

    .requests-table tr:hover {
      background-color: #f9f9f9;
    }

    .requests-table tr.hidden-row {
      display: none;
    }

    .empty-state {
      color: ${COLORS.textMuted};
      font-style: italic;
    }
  `;

  const additionalJS = `
    var activeStatuses = new Set(['pending']);

    function toggleStatus(status) {
      if (activeStatuses.has(status)) {
        activeStatuses.delete(status);
      } else {
        activeStatuses.add(status);
      }
      applyFilters();
    }

    function applyFilters() {
      document.querySelectorAll('.status-filter').forEach(function(btn) {
        btn.classList.toggle('active', activeStatuses.has(btn.dataset.status));
      });

      var visible = 0;
      document.querySelectorAll('.requests-table tbody tr').forEach(function(row) {
        var show = activeStatuses.size === 0 || activeStatuses.has(row.dataset.status);
        row.classList.toggle('hidden-row', !show);
        if (show) visible++;
      });

      var counter = document.getElementById('visible-count');
      if (counter) counter.textContent = visible;
    }

    applyFilters();
  `;

  return getWebTemplate(`Admin - ${serviceName}`, serviceName, content, additionalCSS, additionalJS);
};
