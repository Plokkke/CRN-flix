// Escapes untrusted values before interpolation into a template
export const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const MARKDOWN_LINK = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
const BARE_URL = /(^|[^"'>=])(https?:\/\/[^\s<]+)/g;

const anchor = (href: string, label: string): string =>
  `<a href="${href}" target="_blank" rel="noopener noreferrer">${label}</a>`;

// Escapes a value, then turns markdown links `[label](url)` and bare URLs into anchors.
// Ticket views share Discord's markdown for links; the web adapter needs real anchors.
export const renderRichText = (value: string): string =>
  escapeHtml(value)
    .replace(MARKDOWN_LINK, (_match, label: string, href: string) => anchor(href, label))
    .replace(BARE_URL, (_match, prefix: string, href: string) => `${prefix}${anchor(href, href)}`);
