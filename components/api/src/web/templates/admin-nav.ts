import { escapeHtml } from '@crn-flix/design-system';

/** Where an admin page sits: its top tab, and its sub tab when the tab holds several pages. */
export type AdminLocation =
  | { tab: 'requests' | 'tickets' | 'library' | 'policies' }
  | { tab: 'members'; sub: 'users' | 'announce' | 'messages' }
  | { tab: 'system'; sub: 'jobs' | 'naming-audit' };

type Link = { key: string; label: string; href: string };

const TABS: Link[] = [
  { key: 'requests', label: 'Demandes', href: '/admin' },
  { key: 'tickets', label: 'Tickets', href: '/admin/tickets' },
  { key: 'library', label: 'Bibliothèque', href: '/admin/library' },
  { key: 'policies', label: 'Règles', href: '/admin/policies' },
  { key: 'members', label: 'Membres', href: '/admin/users' },
  { key: 'system', label: 'Système', href: '/admin/jobs' },
];

const SUB_TABS: Record<string, Link[]> = {
  members: [
    { key: 'users', label: 'Comptes', href: '/admin/users' },
    { key: 'announce', label: 'Annonces', href: '/admin/announce' },
    { key: 'messages', label: 'Messages envoyés', href: '/admin/messages' },
  ],
  system: [
    { key: 'jobs', label: 'Jobs', href: '/admin/jobs' },
    { key: 'naming-audit', label: 'Audit de nommage', href: '/admin/naming-audit' },
  ],
};

const link = (item: Link, active: boolean): string =>
  `<a href="${item.href}" data-nav="${item.key}"${active ? ' class="active" aria-current="page"' : ''}>${escapeHtml(item.label)}</a>`;

/** The tabs on top of every admin page; badges (open tickets…) are filled in after load. */
export function adminNav(location: AdminLocation): string {
  const tabs = TABS.map((tab) => link(tab, tab.key === location.tab)).join('');
  const current = 'sub' in location ? location.sub : null;
  const sub = SUB_TABS[location.tab];
  const subTabs = sub
    ? `<nav class="admin-subtabs">${sub.map((item) => link(item, item.key === current)).join('')}</nav>`
    : '';
  return `<nav class="admin-tabs">${tabs}<form method="POST" action="/admin/logout"><button type="submit">Déconnexion</button></form></nav>${subTabs}`;
}

export const ADMIN_NAV_CSS = `
  .admin-tabs { display: flex; flex-wrap: wrap; gap: 2px; align-items: center; border-bottom: 1px solid var(--border); margin: -8px 0 16px 0; }
  .admin-tabs a, .admin-subtabs a { padding: 8px 12px; color: var(--text-light); text-decoration: none; font-size: 14px; border-bottom: 2px solid transparent; margin-bottom: -1px; }
  .admin-tabs a:hover, .admin-subtabs a:hover { color: var(--text); }
  .admin-tabs a.active { color: var(--heading); border-bottom-color: var(--accent); font-weight: 600; }
  .admin-tabs form { margin: 0 0 0 auto; }
  .admin-tabs form button { width: auto; margin: 0; padding: 4px 10px; font-size: 12px; background: transparent; color: var(--text-muted); border: 1px solid var(--border); }
  .admin-subtabs { display: flex; flex-wrap: wrap; gap: 2px; margin: -10px 0 16px 0; }
  .admin-subtabs a { font-size: 13px; padding: 6px 10px; }
  .admin-subtabs a.active { color: var(--heading); border-bottom-color: var(--link); }
  .nav-badge { display: inline-block; min-width: 18px; margin-left: 6px; padding: 0 6px; border-radius: 9px; font-size: 11px; line-height: 18px; text-align: center; background: var(--accent); color: #fff; }
`;

export const ADMIN_NAV_JS = `
  (async () => {
    try {
      const response = await fetch('/admin/nav/counts', { headers: { Accept: 'application/json' } });
      if (!response.ok) return;
      const counts = await response.json();
      Object.entries(counts).forEach(([key, count]) => {
        const tab = document.querySelector('.admin-tabs a[data-nav="' + key + '"]');
        if (!tab || !count) return;
        const badge = document.createElement('span');
        badge.className = 'nav-badge';
        badge.textContent = String(count);
        tab.append(badge);
      });
    } catch (error) {
      console.warn('Admin nav counts:', error);
    }
  })();
`;
