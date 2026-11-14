import { adminNav } from '@/web/templates/admin-nav';

describe('adminNav', () => {
  it('shows every top tab with the current one marked, and logout at hand', () => {
    const html = adminNav({ tab: 'library' });

    expect(html).toContain('<a href="/admin" data-nav="requests">Demandes</a>');
    expect(html).toContain(
      '<a href="/admin/library" data-nav="library" class="active" aria-current="page">Bibliothèque</a>',
    );
    expect(html).toContain('action="/admin/logout"');
    expect(html).not.toContain('admin-subtabs');
  });

  it('opens the sub tabs of a tab holding several pages', () => {
    const html = adminNav({ tab: 'members', sub: 'announce' });

    expect(html).toContain('<a href="/admin/users" data-nav="members" class="active" aria-current="page">Membres</a>');
    expect(html).toContain(
      '<a href="/admin/announce" data-nav="announce" class="active" aria-current="page">Annonces</a>',
    );
    expect(html).toContain('<a href="/admin/messages" data-nav="messages">Messages envoyés</a>');
  });
});
