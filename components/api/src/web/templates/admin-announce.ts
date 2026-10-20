import { COLORS, escapeHtml, getWebTemplate, RADIUS } from '@crn-flix/design-system';

import { NOTICE_PRESETS, NoticePreset, PRESET_LABELS } from '@/services/announcements/presets';
import { ScheduledAnnouncementEntity } from '@/services/database/scheduled-announcements';
import { UserEntity } from '@/services/database/users';
import { NOTICE_TONES, ServiceNotice } from '@/services/messaging/user';

const TONE_LABELS: Record<ServiceNotice['tone'], string> = {
  warning: 'Alerte (orange)',
  success: 'Bonne nouvelle (vert)',
  info: 'Information (bleu)',
};

const CHANNEL_ICONS: Record<string, string> = { email: '✉️', discord: '💬' };

interface AdminAnnounceFormParams {
  serviceName: string;
  /** Null when the form comes back with what the admin typed. */
  preset: NoticePreset | null;
  notice: ServiceNotice;
  recipients: UserEntity[];
  /** Every recipient is checked unless the form comes back with a selection. */
  selectedUserIds?: string[];
  flashMessage?: string;
  /** Shown as an error: the form was refused. */
  flashError?: boolean;
  /** `sendAt` is a `datetime-local` value; dates are shown in the service's time zone. */
  schedule: { sendAt: string; quietLabel: string; format: (date: Date) => string };
  upcoming: ScheduledAnnouncementEntity[];
  sent: ScheduledAnnouncementEntity[];
}

const ADMIN_CSS = `
  .container { max-width: 900px; background-color: #1a1a2e; color: #e0e0e0; }
  body { background-color: #0f0f1a; color: #e0e0e0; }
  .header { background-color: #16162a; }
  h2 { color: #e0e0e0; margin: 20px 0 15px 0; font-size: 20px; }
  a { color: ${COLORS.info}; }
  .flash-message {
    background-color: #1e2a3a; padding: 12px 16px; border-left: 4px solid ${COLORS.info};
    border-radius: 4px; margin-bottom: 20px; color: #e0e0e0;
  }
  .filter-tabs { display: flex; gap: 8px; margin-bottom: 20px; }
  .filter-tab {
    padding: 6px 16px; border-radius: 4px; background-color: #2a2a3e; color: #888;
    text-decoration: none; font-size: 14px; font-weight: bold;
  }
  .filter-tab.active { background-color: ${COLORS.info}; color: #fff; }
  label { color: #e0e0e0; }
  input, textarea, select {
    width: 100%; padding: 12px; border: 1px solid #2a2a3e; border-radius: 4px; font-size: 16px;
    box-sizing: border-box; background-color: #22223a; color: #e0e0e0; font-family: inherit;
  }
  textarea { min-height: 220px; line-height: 1.5; }
  .hint { font-size: 13px; color: #888; margin: 4px 0 0 0; }
  .recipients { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 8px; }
  .recipient {
    display: flex; align-items: center; gap: 10px; padding: 10px 12px; border-radius: 6px;
    background: #22223a; border: 1px solid #2a2a3e; cursor: pointer; font-weight: normal;
  }
  .recipient input { width: auto; margin: 0; }
  .recipient .channel { color: #888; font-size: 13px; margin-left: auto; }
  .toolbar { display: flex; gap: 12px; margin: 8px 0 16px 0; font-size: 14px; }
  .actions { display: flex; gap: 12px; margin-top: 24px; }
  .actions button { width: auto; padding: 12px 24px; }
  .actions .send { background-color: ${COLORS.secondary}; }
  .actions .preview { background-color: #2a2a3e; }
  .flash-message.error { border-left-color: ${COLORS.error}; background-color: #3a1e24; }
  input[type="datetime-local"] { width: auto; color-scheme: dark; }
  .schedule-row { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; }
  .announcement {
    display: flex; gap: 12px; align-items: center; padding: 12px 14px; margin-bottom: 8px;
    border: 1px solid #2a2a3e; border-radius: ${RADIUS.md}; background: #22223a;
  }
  .announcement .what { flex: 1; min-width: 0; }
  .announcement .subject { font-weight: 600; }
  .announcement .meta { font-size: 13px; color: #888; margin-top: 2px; }
  .announcement form { margin: 0; }
  .announcement button { width: auto; padding: 6px 14px; font-size: 13px; background: transparent; border: 1px solid #3a3a52; color: #e0e0e0; }
  .count-sent { color: ${COLORS.success}; }
  .count-failed { color: #ff8888; }
`;

const recipientRow = (user: UserEntity, checked: boolean): string => `
  <label class="recipient">
    <input type="checkbox" name="users" value="${escapeHtml(user.id)}" ${checked ? 'checked' : ''} />
    <span>${escapeHtml(user.name)}</span>
    <span class="channel">${CHANNEL_ICONS[user.messagingKey] ?? ''} ${escapeHtml(user.messagingKey)}</span>
  </label>
`;

const presetTabs = (active: NoticePreset | null): string =>
  NOTICE_PRESETS.map(
    (key) =>
      `<a class="filter-tab ${key === active ? 'active' : ''}" href="/admin/announce?preset=${key}">${PRESET_LABELS[key]}</a>`,
  ).join('');

const toneOptions = (active: ServiceNotice['tone']): string =>
  NOTICE_TONES.map(
    (tone) => `<option value="${tone}" ${tone === active ? 'selected' : ''}>${TONE_LABELS[tone]}</option>`,
  ).join('');

const noticeFields = (notice: ServiceNotice): string => `
  <div class="form-group">
    <label for="subject">Sujet</label>
    <input type="text" id="subject" name="subject" required value="${escapeHtml(notice.subject)}" />
  </div>
  <div class="form-group">
    <label for="title">Titre</label>
    <input type="text" id="title" name="title" required value="${escapeHtml(notice.title)}" />
  </div>
  <div class="form-group">
    <label for="body">Message</label>
    <textarea id="body" name="body" required>${escapeHtml(notice.paragraphs.join('\n\n'))}</textarea>
    <p class="hint">Un paragraphe par ligne. Le premier est mis en avant dans un encart coloré.</p>
  </div>
  <div class="form-group">
    <label for="tone">Ton</label>
    <select id="tone" name="tone">${toneOptions(notice.tone)}</select>
  </div>
  <div class="form-group">
    <label for="ctaLabel">Bouton (optionnel)</label>
    <input type="text" id="ctaLabel" name="ctaLabel" placeholder="Libellé" value="${escapeHtml(notice.cta?.label ?? '')}" />
    <input type="url" id="ctaUrl" name="ctaUrl" placeholder="https://…" style="margin-top: 8px;" value="${escapeHtml(notice.cta?.url ?? '')}" />
  </div>
`;

const TOGGLE_JS = `
  const boxes = () => Array.from(document.querySelectorAll('input[name="users"]'));
  document.getElementById('select-all').addEventListener('click', (e) => { e.preventDefault(); boxes().forEach((b) => (b.checked = true)); });
  document.getElementById('select-none').addEventListener('click', (e) => { e.preventDefault(); boxes().forEach((b) => (b.checked = false)); });
  document.getElementById('announce-form').addEventListener('submit', (e) => {
    if (e.submitter && e.submitter.classList.contains('send')) {
      const count = boxes().filter((b) => b.checked).length;
      const when = document.getElementById('sendAt').value.replace('T', ' à ');
      if (count === 0 || !confirm('Programmer cette annonce pour ' + count + ' utilisateur(s), le ' + when + ' ?')) e.preventDefault();
    }
  });
`;

type DateFormat = (date: Date) => string;

const upcomingRow = (announcement: ScheduledAnnouncementEntity, format: DateFormat): string => `
  <div class="announcement">
    <div class="what">
      <div class="subject">${escapeHtml(announcement.notice.subject)}</div>
      <div class="meta">Le ${escapeHtml(format(announcement.sendAt))} · ${announcement.userIds.length} destinataire(s)</div>
    </div>
    <form method="POST" action="/admin/announce/${escapeHtml(announcement.id)}/cancel" onsubmit="return confirm('Annuler cette annonce ?')">
      <button type="submit">Annuler</button>
    </form>
  </div>
`;

const sentRow = (announcement: ScheduledAnnouncementEntity, format: DateFormat): string => {
  const outcomes = announcement.outcomes ?? [];
  const failed = outcomes.filter((o) => o.outcome === 'failed');
  const failedNames = failed.map((o) => escapeHtml(o.userName)).join(', ');
  return `
  <div class="announcement">
    <div class="what">
      <div class="subject">${escapeHtml(announcement.notice.subject)}</div>
      <div class="meta">Envoyée le ${escapeHtml(format(announcement.sentAt ?? announcement.sendAt))}${failedNames ? ` · échec : ${failedNames}` : ''}</div>
    </div>
    ${
      announcement.outcomes
        ? `<span class="count-sent">${outcomes.length - failed.length} ✓</span><span class="count-failed">${failed.length ? `${failed.length} ✗` : ''}</span>`
        : '<span class="hint">En cours…</span>'
    }
  </div>
`;
};

const announcementLists = (
  upcoming: ScheduledAnnouncementEntity[],
  sent: ScheduledAnnouncementEntity[],
  format: DateFormat,
): string => `
  <h2>Programmées (${upcoming.length})</h2>
  ${upcoming.length ? upcoming.map((a) => upcomingRow(a, format)).join('') : '<p class="hint">Aucune annonce en attente.</p>'}
  <h2>Envoyées récemment</h2>
  ${sent.length ? sent.map((a) => sentRow(a, format)).join('') : '<p class="hint">Aucune annonce envoyée.</p>'}
`;

export const adminAnnounceFormTemplate = (params: AdminAnnounceFormParams): string => {
  const { serviceName, preset, notice, recipients, selectedUserIds, flashMessage, flashError, schedule } = params;
  const isChecked = (user: UserEntity): boolean => !selectedUserIds || selectedUserIds.includes(user.id);

  const content = `
    ${flashMessage ? `<div class="flash-message${flashError ? ' error' : ''}">${escapeHtml(flashMessage)}</div>` : ''}
    <p><a href="/admin">← Dashboard</a></p>
    <h2>📣 Annonce aux abonnés</h2>
    <div class="filter-tabs">${presetTabs(preset)}</div>
    <form id="announce-form" method="POST" action="/admin/announce/send">
      ${noticeFields(notice)}
      <h2>Destinataires (${recipients.length})</h2>
      <div class="toolbar">
        <a href="#" id="select-all">Tout cocher</a>
        <a href="#" id="select-none">Tout décocher</a>
      </div>
      <div class="recipients">${recipients.map((user) => recipientRow(user, isChecked(user))).join('')}</div>
      <h2>Programmer l'envoi</h2>
      <div class="schedule-row">
        <input type="datetime-local" id="sendAt" name="sendAt" value="${escapeHtml(schedule.sendAt)}" />
        <span class="hint">Heure de Paris : rien ne part pendant les quiet hours (${escapeHtml(schedule.quietLabel)}).</span>
      </div>
      <div class="actions">
        <button type="submit" class="preview" formaction="/admin/announce/preview" formtarget="_blank">Prévisualiser</button>
        <button type="submit" class="send">Programmer l'envoi</button>
      </div>
    </form>
    ${announcementLists(params.upcoming, params.sent, schedule.format)}
  `;

  return getWebTemplate(`Annonce - ${serviceName}`, serviceName, content, ADMIN_CSS, TOGGLE_JS);
};
