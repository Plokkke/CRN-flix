import { UserEntity } from '@/services/database/users';
import { adminUsersTemplate } from '@/web/templates/admin-users';

const user = (overrides: Partial<UserEntity>): UserEntity =>
  ({ id: 'u1', name: 'leo', maxStreams: 2, profile: 'kids', ...overrides }) as UserEntity;

describe('adminUsersTemplate', () => {
  const html = adminUsersTemplate({
    serviceName: 'CRN-Flix',
    users: [user({}), user({ id: 'u2', name: 'papa', maxStreams: null, profile: 'adult' })],
  });

  it('lists every account on one line, with fields sent as they change and no save button', () => {
    expect(html).toContain('<table class="users">');
    expect(html).toContain('<form class="live" method="POST" action="/admin/users/u1/max-streams">');
    expect(html).toContain('<option value="kids" selected>enfant</option>');
    expect(html).not.toContain('Enregistrer');
    expect(html).toContain('<div id="live-flash">');
  });

  it('marks a stream limit not read from the player yet', () => {
    expect(html).toContain('placeholder="?" title="Pas encore relevé sur le lecteur"');
  });
});
