import { UserEntity } from '@/services/database/users';
import { adminUsersTemplate } from '@/web/templates/admin-users';

const user = (overrides: Partial<UserEntity>): UserEntity =>
  ({
    id: 'u1',
    name: 'leo',
    maxStreams: 2,
    profile: 'kids',
    messagingKey: 'email',
    adminDiscordId: null,
    ...overrides,
  }) as UserEntity;

describe('adminUsersTemplate', () => {
  const render = (): string =>
    adminUsersTemplate({
      serviceName: 'CRN-Flix',
      users: [
        user({}),
        user({ id: 'u2', name: 'papa', maxStreams: null, profile: 'adult', messagingKey: null, adminDiscordId: '42' }),
        user({ id: 'g', name: 'Invité', guest: true }),
      ],
      adminIds: ['42', '43'],
      currentAdminId: '42',
    });

  it('lists every account on one line, with fields sent as they change and no save button', () => {
    const html = render();

    expect(html).toContain('<table class="users">');
    expect(html).toContain('<form class="live" method="POST" action="/admin/users/u1/max-streams">');
    expect(html).toContain('<option value="kids" selected>enfant</option>');
    expect(html).not.toContain('Enregistrer');
    expect(html).toContain('<div id="live-flash">');
    expect(html).toContain('placeholder="?" title="Pas encore relevé sur le lecteur"');
  });

  it('links an account to a Discord admin, the viewer being « moi », and shows who has no messaging', () => {
    const html = render();

    expect(html).toContain('<option value="42" selected>moi (42)</option>');
    expect(html).toContain('<option value="43">43</option>');
    expect(html).toContain('<td class="hint">-</td>');
  });

  it('marks a guest account with its own checkbox', () => {
    expect(render()).toMatch(
      /action="\/admin\/users\/g\/guest"><input type="checkbox" name="guest" value="on" checked/,
    );
  });
});
