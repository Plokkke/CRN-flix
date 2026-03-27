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

const formatDate = (date: Date): string => {
  return new Date(date).toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

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

const getRequestsSection = (requests: RequestEntity[]): string => {
  if (requests.length === 0) {
    return `
      <h2>Requests (0)</h2>
      <p class="empty-state">No requests yet.</p>
    `;
  }

  const rows = requests
    .map(
      (request) => `
    <tr>
      <td>${getMediaLabel(request)}</td>
      <td>${request.media?.type ?? '-'}</td>
      <td><span style="${getStatusStyle(request.status)}">${request.status}</span></td>
      <td>${request.userRequests?.map((ur) => ur.user?.name ?? 'Unknown').join(', ') ?? '-'}</td>
      <td>${formatDate(request.createdAt)}</td>
    </tr>
  `,
    )
    .join('');

  return `
    <h2>Requests (${requests.length})</h2>
    <div class="table-wrapper">
      <table class="requests-table">
        <thead>
          <tr>
            <th>Media</th>
            <th>Type</th>
            <th>Status</th>
            <th>Users</th>
            <th>Created</th>
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

    .empty-state {
      color: ${COLORS.textMuted};
      font-style: italic;
    }
  `;

  return getWebTemplate(`Admin - ${serviceName}`, serviceName, content, additionalCSS);
};
