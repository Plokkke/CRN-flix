import { COLORS, escapeHtml, getWebTemplate } from '@crn-flix/design-system';

import { UserEntity } from '@/services/database/users';

interface AdminUsersParams {
  serviceName: string;
  users: UserEntity[];
  flashMessage?: string;
}

const USERS_CSS = `
  .container { max-width: 900px; background-color: #1a1a2e; color: #e0e0e0; }
  body { background-color: #0f0f1a; color: #e0e0e0; }
  .header { background-color: #16162a; }
  h2 { color: #e0e0e0; margin: 20px 0 15px 0; font-size: 20px; }
  a { color: ${COLORS.info}; }
  .flash-message {
    background-color: #1e2a3a; padding: 12px 16px; border-left: 4px solid ${COLORS.info};
    border-radius: 4px; margin-bottom: 20px; color: #e0e0e0;
  }
  .hint { font-size: 13px; color: #888; }
  .user-row {
    display: flex; align-items: center; gap: 12px; padding: 10px 12px; border-radius: 6px;
    background: #22223a; border: 1px solid #2a2a3e; margin-bottom: 8px;
  }
  .user-row .name { flex: 1; }
  .user-row input {
    width: 80px; padding: 8px; border: 1px solid #2a2a3e; border-radius: 4px;
    background-color: #1a1a2e; color: #e0e0e0; font-size: 15px;
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
  return getWebTemplate('Comptes', serviceName, content, USERS_CSS);
};
