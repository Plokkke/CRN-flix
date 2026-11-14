import { escapeHtml, LIVE_FORMS_CSS, LIVE_FORMS_JS, liveFlashSlot } from '@crn-flix/design-system';

import { UserEntity } from '@/services/database/users';
import { Profile, PROFILES } from '@/services/policy/shelves';
import { adminPage } from '@/web/templates/admin-page';

export const PROFILE_LABELS: Record<Profile, string> = { adult: 'adulte', kids: 'enfant' };

interface AdminUsersParams {
  serviceName: string;
  users: UserEntity[];
  flashMessage?: string;
}

const USERS_CSS = `
  .container { max-width: 900px; }
  h2 { color: var(--text); margin: 20px 0 15px 0; font-size: 20px; }
  .hint { font-size: 13px; color: var(--text-muted); }
  table.users { width: 100%; border-collapse: collapse; font-size: 14px; }
  table.users th { text-align: left; color: var(--text-muted); font-weight: 600; padding: 6px 8px; border-bottom: 1px solid var(--border); }
  table.users td { padding: 4px 8px; border-bottom: 1px solid var(--border-light); vertical-align: middle; }
  table.users input, table.users select {
    width: auto; margin: 0; padding: 4px 6px; border: 1px solid var(--border); border-radius: 4px;
    background: var(--surface); color: var(--text); font-size: 14px;
  }
  table.users input[type='number'] { width: 70px; }
  ${LIVE_FORMS_CSS}
`;

const streamsCell = (user: UserEntity): string => `
  <form class="live" method="POST" action="/admin/users/${escapeHtml(user.id)}/max-streams">
    <input type="number" min="0" name="maxStreams" required aria-label="Flux simultanés de ${escapeHtml(user.name)}"
      value="${user.maxStreams ?? ''}"${user.maxStreams === null ? ' placeholder="?" title="Pas encore relevé sur le lecteur"' : ''} />
  </form>`;

const profileCell = (user: UserEntity): string => `
  <form class="live" method="POST" action="/admin/users/${escapeHtml(user.id)}/profile">
    <select name="profile" aria-label="Profil de ${escapeHtml(user.name)}">${PROFILES.map(
      (profile) =>
        `<option value="${profile}"${profile === user.profile ? ' selected' : ''}>${PROFILE_LABELS[profile]}</option>`,
    ).join('')}</select>
  </form>`;

const userRow = (user: UserEntity): string =>
  `<tr><td>${escapeHtml(user.name)}</td><td>${streamsCell(user)}</td><td>${profileCell(user)}</td></tr>`;

export const adminUsersTemplate = ({ serviceName, users, flashMessage }: AdminUsersParams): string => {
  const content = `
    <p><a href="/admin">← Dashboard</a></p>
    <h2>👥 Comptes de visionnage</h2>
    <p class="hint">Chaque changement s’applique tout de suite. Flux simultanés : 0 = illimité. Profil : les étagères visibles. Les administrateurs du lecteur ne sont jamais modifiés.</p>
    ${liveFlashSlot(flashMessage)}
    <table class="users"><thead><tr><th>Compte</th><th>Flux simultanés</th><th>Profil</th></tr></thead>
      <tbody>${users.map(userRow).join('')}</tbody></table>
  `;
  return adminPage('Comptes', serviceName, content, USERS_CSS, LIVE_FORMS_JS);
};
