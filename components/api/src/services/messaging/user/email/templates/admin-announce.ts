import { NOTICE_PRESETS, NoticePreset, PRESET_LABELS } from '@/services/announcements/presets';
import { DeliveryResult } from '@/services/announcements/service';
import { UserEntity } from '@/services/database/users';
import { NOTICE_TONES, ServiceNotice } from '@/services/messaging/user';

import { COLORS, escapeHtml, getWebTemplate } from './email-styles';

const TONE_LABELS: Record<ServiceNotice['tone'], string> = {
  warning: 'Alerte (orange)',
  success: 'Bonne nouvelle (vert)',
  info: 'Information (bleu)',
};

const CHANNEL_ICONS: Record<string, string> = { email: '✉️', discord: '💬' };

interface AdminAnnounceFormParams {
  serviceName: string;
  preset: NoticePreset;
  notice: ServiceNotice;
  recipients: UserEntity[];
  flashMessage?: string;
}

interface AdminAnnounceResultParams {
  serviceName: string;
  notice: ServiceNotice;
  results: DeliveryResult[];
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
  .result { display: flex; gap: 12px; padding: 10px 12px; border-radius: 6px; margin-bottom: 6px; background: #22223a; }
  .result.sent { border-left: 4px solid ${COLORS.success}; }
  .result.failed { border-left: 4px solid ${COLORS.error}; }
  .result .error { color: #ff8888; font-size: 13px; }
`;

const recipientRow = (user: UserEntity): string => `
  <label class="recipient">
    <input type="checkbox" name="users" value="${escapeHtml(user.id)}" checked />
    <span>${escapeHtml(user.name)}</span>
    <span class="channel">${CHANNEL_ICONS[user.messagingKey] ?? ''} ${escapeHtml(user.messagingKey)}</span>
  </label>
`;

const presetTabs = (active: NoticePreset): string =>
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
      if (count === 0 || !confirm('Envoyer cette annonce à ' + count + ' utilisateur(s) ?')) e.preventDefault();
    }
  });
`;

export const adminAnnounceFormTemplate = (params: AdminAnnounceFormParams): string => {
  const { serviceName, preset, notice, recipients, flashMessage } = params;

  const content = `
    ${flashMessage ? `<div class="flash-message">${escapeHtml(flashMessage)}</div>` : ''}
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
      <div class="recipients">${recipients.map(recipientRow).join('')}</div>
      <div class="actions">
        <button type="submit" class="preview" formaction="/admin/announce/preview" formtarget="_blank">Prévisualiser</button>
        <button type="submit" class="send">Envoyer</button>
      </div>
    </form>
  `;

  return getWebTemplate(`Annonce - ${serviceName}`, serviceName, content, ADMIN_CSS, TOGGLE_JS);
};

const resultRow = ({ user, outcome, error }: DeliveryResult): string => `
  <div class="result ${outcome}">
    <span>${outcome === 'sent' ? '✅' : '❌'}</span>
    <span>${escapeHtml(user.name)}</span>
    <span class="channel">${escapeHtml(user.messagingKey)}</span>
    ${error ? `<span class="error">${escapeHtml(error)}</span>` : ''}
  </div>
`;

export const adminAnnounceResultTemplate = (params: AdminAnnounceResultParams): string => {
  const { serviceName, notice, results } = params;
  const sent = results.filter((r) => r.outcome === 'sent').length;
  const failed = results.length - sent;

  const content = `
    <p><a href="/admin/announce">← Nouvelle annonce</a> · <a href="/admin">Dashboard</a></p>
    <h2>📣 « ${escapeHtml(notice.subject)} »</h2>
    <div class="flash-message">${sent} envoyé(s), ${failed} échec(s).</div>
    ${results.length ? results.map(resultRow).join('') : '<p class="hint">Aucun destinataire sélectionné.</p>'}
  `;

  return getWebTemplate(`Annonce envoyée - ${serviceName}`, serviceName, content, ADMIN_CSS);
};
