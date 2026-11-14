import { getWebTemplate } from '@crn-flix/design-system';

import { appVersion } from '@/helpers/version';
import { ADMIN_NAV_CSS, ADMIN_NAV_JS, adminNav, AdminLocation } from '@/web/templates/admin-nav';

/** Every admin page: the dark theme, the tabs on top and the deployed version in the header. */
export const adminPage = (
  location: AdminLocation,
  title: string,
  serviceName: string,
  content: string,
  css = '',
  js = '',
): string =>
  getWebTemplate(
    title,
    serviceName,
    `${adminNav(location)}${content}`,
    `${ADMIN_NAV_CSS}${css}`,
    `${ADMIN_NAV_JS}${js}`,
    'dark',
    appVersion(),
  );
