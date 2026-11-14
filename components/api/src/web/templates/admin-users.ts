import { escapeHtml, LIVE_FORMS_CSS, LIVE_FORMS_JS, liveFlashSlot } from '@crn-flix/design-system';

import { UserEntity } from '@/services/database/users';
import { Profile, PROFILES } from '@/services/policy/shelves';
import { adminPage } from '@/web/templates/admin-page';

export const PROFILE_LABELS: Record<Profile, string> = { adult: 'adulte', kids: 'enfant' };

interface AdminUsersParams {
  serviceName: string;
  users: UserEntity[];
  /** The Discord admins (DISCORD_ADMIN_IDS) and the one looking at the page. */
  adminIds: string[];
  currentAdminId: string | null;
  flashMessage?: string;
}

const USERS_CSS = `
  .container { max-width: 960px; }
  h2 { color: var(--text); margin: 20px 0 15px 0; font-size: 20px; }
  h3 { color: var(--text); margin: 24px 0 8px 0; font-size: 16px; }
  .hint { font-size: 13px; color: var(--text-muted); }
  table.users { width: 100%; border-collapse: collapse; font-size: 14px; }
  table.users th { text-align: left; color: var(--text-muted); font-weight: 600; padding: 6px 8px; border-bottom: 1px solid var(--border); }
  table.users td { padding: 4px 8px; border-bottom: 1px solid var(--border-light); vertical-align: middle; }
  table.users input, table.users select {
    width: auto; margin: 0; padding: 4px 6px; border: 1px solid var(--border); border-radius: 4px;
    background: var(--surface); color: var(--text); font-size: 14px;
  }
  table.users input[type='number'] { width: 70px; }
  table.users button { width: auto; margin: 0; padding: 4px 12px; font-size: 13px; }
  ${LIVE_FORMS_CSS}
`;

const liveForm = (action: string, field: string): string =>
  `<form class="live" method="POST" action="${escapeHtml(action)}">${field}</form>`;

const option = (value: string, label: string, selected: boolean): string =>
  `<option value="${escapeHtml(value)}"${selected ? ' selected' : ''}>${escapeHtml(label)}</option>`;

const streamsCell = (user: UserEntity): string =>
  liveForm(
    `/admin/users/${user.id}/max-streams`,
    `<input type="number" min="0" name="maxStreams" required aria-label="Flux simultanés de ${escapeHtml(user.name)}"
      value="${user.maxStreams ?? ''}"${user.maxStreams === null ? ' placeholder="?" title="Pas encore relevé sur le lecteur"' : ''} />`,
  );

const profileCell = (user: UserEntity): string =>
  liveForm(
    `/admin/users/${user.id}/profile`,
    `<select name="profile" aria-label="Profil de ${escapeHtml(user.name)}">${PROFILES.map((profile) =>
      option(profile, PROFILE_LABELS[profile], profile === user.profile),
    ).join('')}</select>`,
  );

function adminCell(user: UserEntity, params: AdminUsersParams): string {
  const label = (adminId: string): string => (adminId === params.currentAdminId ? `moi (${adminId})` : adminId);
  const options = [
    option('', '—', user.adminDiscordId === null),
    ...params.adminIds.map((adminId) => option(adminId, label(adminId), adminId === user.adminDiscordId)),
  ];
  return liveForm(
    `/admin/users/${user.id}/admin`,
    `<select name="adminId" aria-label="Admin Discord de ${escapeHtml(user.name)}">${options.join('')}</select>`,
  );
}

const guestCell = (user: UserEntity): string =>
  liveForm(
    `/admin/users/${user.id}/guest`,
    `<input type="checkbox" name="guest" value="on"${user.guest ? ' checked' : ''} aria-label="${escapeHtml(user.name)} est un compte invité" />`,
  );

const userRow = (user: UserEntity, params: AdminUsersParams): string => `<tr>
    <td>${escapeHtml(user.name)}</td>
    <td>${guestCell(user)}</td>
    <td class="hint">${escapeHtml(user.messagingKey ?? '-')}</td>
    <td>${streamsCell(user)}</td>
    <td>${profileCell(user)}</td>
    <td>${adminCell(user, params)}</td>
  </tr>`;

export const adminUsersTemplate = (params: AdminUsersParams): string => {
  const content = `
    <p><a href="/admin">← Dashboard</a></p>
    <h2>👥 Comptes de visionnage</h2>
    <p class="hint">Chaque changement s’applique tout de suite. Tout compte du lecteur est un abonné, avec ou sans messagerie. Invité : compte partagé, sans étagère personnelle (en bas de la liste). Flux simultanés : 0 = illimité. Profil : les étagères visibles. Admin Discord : ce que cet admin garde pour lui (« Ma collection ») arrive sur l’étagère personnelle de ce compte. Un administrateur du lecteur garde ses droits : seules ses étagères (et une limite de flux fixée ici) suivent son profil.</p>
    ${liveFlashSlot(params.flashMessage)}
    <table class="users"><thead><tr><th>Compte</th><th>Invité</th><th>Messagerie</th><th>Flux simultanés</th><th>Profil</th><th>Admin Discord</th></tr></thead>
      <tbody>${params.users.map((user) => userRow(user, params)).join('')}</tbody></table>
  `;
  return adminPage('Comptes', params.serviceName, content, USERS_CSS, LIVE_FORMS_JS);
};
