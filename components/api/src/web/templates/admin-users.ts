import { COLORS, escapeHtml, getWebTemplate } from '@crn-flix/design-system';

import { UserEntity } from '@/services/database/users';

interface AdminUsersParams {
  serviceName: string;
  users: UserEntity[];
  flashMessage?: string;
}

const USERS_CSS = `
  .container { max-width: 900px; }
  h2 { color: var(--text); margin: 20px 0 15px 0; font-size: 20px; }
  .flash-message {
    background-color: var(--tone-info-bg); padding: 12px 16px; border-left: 4px solid ${COLORS.info};
    border-radius: 4px; margin-bottom: 20px; color: var(--text);
  }
  .hint { font-size: 13px; color: var(--text-muted); }
  .user-row {
    display: flex; align-items: center; gap: 12px; padding: 10px 12px; border-radius: 6px;
    background: var(--surface-raised); border: 1px solid var(--border); margin-bottom: 8px;
  }
  .user-row .name { flex: 1; }
  .user-row input {
    width: 80px; padding: 8px; border: 1px solid var(--border); border-radius: 4px;
    background-color: var(--surface); color: var(--text); font-size: 15px;
  }
  .user-row button { width: auto; padding: 8px 16px; }
`;

const streamsLabel = (user: UserEntity): string => {
  if (user.maxStreams === null) {
    return 'pas encore relevé';
  }
  return user.maxStreams === 0 ? 'illimité' : `${user.maxStreams}`;
};

const userRow = (user: UserEntity): string => `
  <form class="user-row" method="POST" action="/admin/users/${escapeHtml(user.id)}/max-streams">
    <span class="name">${escapeHtml(user.name)} <span class="hint">(${streamsLabel(user)})</span></span>
    <label class="hint" for="streams-${escapeHtml(user.id)}">Flux simultanés</label>
    <input type="number" min="0" id="streams-${escapeHtml(user.id)}" name="maxStreams" required
      value="${user.maxStreams ?? ''}" />
    <button type="submit">Enregistrer</button>
  </form>
`;

export const adminUsersTemplate = ({ serviceName, users, flashMessage }: AdminUsersParams): string => {
  const content = `
    ${flashMessage ? `<div class="flash-message">${escapeHtml(flashMessage)}</div>` : ''}
    <p><a href="/admin">← Dashboard</a></p>
    <h2>👥 Comptes de visionnage</h2>
    <p class="hint">Lectures simultanées autorisées sur le lecteur (0 = illimité). Les administrateurs du lecteur ne sont jamais modifiés.</p>
    ${users.map(userRow).join('')}
  `;
  return getWebTemplate('Comptes', serviceName, content, USERS_CSS, '', 'dark');
};
