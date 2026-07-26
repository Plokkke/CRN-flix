import { RequestEntity } from '@/services/database/requests';
import { indexerDisplayLink } from '@/services/indexer-link';

import { COLORS, escapeHtml, getWebTemplate } from './email-styles';

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

const getStatusFilters = (requests: RequestEntity[]): string => {
  const buttons = STATUSES.map(
    (status) => `
    <button
      type="button"
      class="status-filter status-${status} ${status === 'pending' ? 'active' : ''}"
      data-status="${status}"
      onclick="selectStatus('${status}')"
    >${status}</button>
  `,
  ).join('');

  const users = [
    ...new Set(requests.flatMap((r) => r.userRequests?.map((ur) => ur.user?.name ?? 'Unknown') ?? [])),
  ].sort();
  const userOptions = users.map((u) => `<option value="${u}">${u}</option>`).join('');

  return `
    <div class="filters-row">
      <div class="status-filters">${buttons}</div>
      <select id="user-filter" onchange="applyFilters()">
        <option value="">All users</option>
        ${userOptions}
      </select>
    </div>
  `;
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
    .map((request) => {
      const users = request.userRequests?.map((ur) => ur.user?.name ?? 'Unknown').join(', ') ?? '-';
      const displayLink = indexerDisplayLink(request);
      return `
    <tr data-status="${request.status}" data-users="${users}">
      <td>${displayLink ? `<a href="${displayLink}" target="_blank" rel="noopener">${getMediaLabel(request)}</a>` : getMediaLabel(request)}</td>
      <td>${request.media?.type ?? '-'}</td>
      <td><code>${request.media?.imdbId ?? '-'}</code></td>
      <td>${users}</td>
    </tr>
  `;
    })
    .join('');

  return `
    <h2>Requests (<span id="visible-count">0</span>)</h2>
    ${getStatusFilters(requests)}
    <div class="table-wrapper">
      <table class="requests-table">
        <thead>
          <tr>
            <th>Media</th>
            <th>Type</th>
            <th>IMDB</th>
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

  const flashHtml = flashMessage ? `<div class="flash-message">${escapeHtml(flashMessage)}</div>` : '';

  const content = `
    ${flashHtml}
    ${getJobsSection(jobs)}
    ${getRequestsSection(requests)}
    <form method="POST" action="/admin/logout" class="logout-form">
      <button type="submit">Se déconnecter</button>
    </form>
  `;

  const additionalCSS = `
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

    .filters-row {
      display: flex;
      gap: 16px;
      margin-bottom: 16px;
      flex-wrap: wrap;
      align-items: center;
    }

    .status-filters {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
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
      background-color: #2a2a3e !important;
      color: #666 !important;
      border-color: #2a2a3e !important;
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
      background-color: #16162a;
      color: #ccc;
      padding: 10px 12px;
      text-align: left;
      white-space: nowrap;
    }

    .requests-table td {
      padding: 10px 12px;
      border-bottom: 1px solid #2a2a3e;
      color: #e0e0e0;
    }

    .requests-table a {
      color: ${COLORS.info};
    }

    .requests-table code {
      background-color: #2a2a3e;
      padding: 2px 6px;
      border-radius: 3px;
      font-size: 12px;
      color: #ccc;
    }

    .requests-table tr:hover {
      background-color: #22223a;
    }

    .requests-table tr.hidden-row {
      display: none;
    }

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

  const additionalJS = `
    var activeStatus = 'pending';

    function selectStatus(status) {
      activeStatus = activeStatus === status ? null : status;
      applyFilters();
    }

    function applyFilters() {
      document.querySelectorAll('.status-filter').forEach(function(btn) {
        btn.classList.toggle('active', btn.dataset.status === activeStatus);
      });

      var userFilter = document.getElementById('user-filter').value;
      var visible = 0;
      document.querySelectorAll('.requests-table tbody tr').forEach(function(row) {
        var statusMatch = !activeStatus || row.dataset.status === activeStatus;
        var userMatch = !userFilter || row.dataset.users.split(', ').indexOf(userFilter) !== -1;
        var show = statusMatch && userMatch;
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
