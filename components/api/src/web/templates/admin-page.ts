import { getWebTemplate } from '@crn-flix/design-system';

import { appVersion } from '@/helpers/version';

/** Every admin page: the dark theme and the deployed version in the header. */
export const adminPage = (title: string, serviceName: string, content: string, css = '', js = ''): string =>
  getWebTemplate(title, serviceName, content, css, js, 'dark', appVersion());
