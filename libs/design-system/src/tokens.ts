// Inline styles and table-based layouts: emails need them, web pages reuse them.
// One accent (the brand red, for the main action only), neutral surfaces, and soft tinted
// tones for every status: color carries meaning, it never shouts.

export const FONT_STACK =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Helvetica, Arial, sans-serif";

export const COLORS = {
  // Brand
  primary: '#16161d',
  secondary: '#d92d3a',
  accentHover: '#b8232f',

  // Status (strong tones: text, icons, borders)
  success: '#12805c',
  warning: '#b54708',
  error: '#c4320a',
  info: '#2e6be6',
  gray: '#667085',
  orange: '#c4580a',

  // Surfaces and text
  background: '#f4f4f6',
  white: '#ffffff',
  surfaceMuted: '#f9fafb',
  text: '#1d2939',
  textLight: '#475467',
  textMuted: '#667085',
  border: '#e4e7ec',
  borderLight: '#f2f4f7',
  footerBg: '#f9fafb',
  footerText: '#667085',
} as const;

export type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

/** Tinted background, readable text and a hairline border per tone. */
export const TONES: Record<Tone, { bg: string; text: string; border: string }> = {
  neutral: { bg: '#f2f4f7', text: '#344054', border: '#e4e7ec' },
  info: { bg: '#eff4ff', text: '#1f4fb8', border: '#d1e0ff' },
  success: { bg: '#ecfdf3', text: '#0b6b4c', border: '#c6f0dc' },
  warning: { bg: '#fffaeb', text: '#93370d', border: '#fde7b0' },
  danger: { bg: '#fef3f2', text: '#b42318', border: '#fdd5d0' },
};

export const RADIUS = { sm: '6px', md: '10px', lg: '14px', pill: '999px' } as const;

export const TYPOGRAPHY = {
  h1: `font-family: ${FONT_STACK}; font-size: 24px; font-weight: 700; letter-spacing: -0.01em; color: ${COLORS.primary}; margin: 0 0 16px 0; line-height: 1.25;`,
  h2: `font-family: ${FONT_STACK}; font-size: 18px; font-weight: 650; color: ${COLORS.primary}; margin: 0 0 10px 0; line-height: 1.35;`,
  h3: `font-family: ${FONT_STACK}; font-size: 16px; font-weight: 600; color: ${COLORS.primary}; margin: 16px 0 8px 0; line-height: 1.4;`,
  body: `font-family: ${FONT_STACK}; font-size: 15px; color: ${COLORS.textLight}; line-height: 1.6; margin: 0 0 12px 0;`,
  small: `font-family: ${FONT_STACK}; font-size: 13px; color: ${COLORS.textLight}; line-height: 1.5;`,
  muted: `font-family: ${FONT_STACK}; font-size: 13px; color: ${COLORS.textMuted}; line-height: 1.5;`,
} as const;

const BUTTON_BASE = `display: inline-block; padding: 11px 20px; text-decoration: none; border-radius: ${RADIUS.md}; font-family: ${FONT_STACK}; font-weight: 600; font-size: 15px; line-height: 1.2; text-align: center;`;

export const BUTTONS = {
  /** The one action that matters on the page. */
  primary: `${BUTTON_BASE} background-color: ${COLORS.secondary}; color: #ffffff; border: 1px solid ${COLORS.secondary};`,
  /** Everything else: quiet, outlined. */
  secondary: `${BUTTON_BASE} background-color: #ffffff; color: ${COLORS.primary}; border: 1px solid ${COLORS.border};`,
} as const;

/** Small rounded label, tinted by tone. */
export const pillStyle = (tone: Tone): string =>
  `display: inline-block; padding: 3px 10px; border-radius: ${RADIUS.pill}; font-family: ${FONT_STACK}; font-size: 12px; font-weight: 600; line-height: 1.5; background-color: ${TONES[tone].bg}; color: ${TONES[tone].text}; border: 1px solid ${TONES[tone].border}; white-space: nowrap;`;

const TONE_BY_STATUS: Record<string, Tone> = {
  pending: 'warning',
  fulfilled: 'success',
  rejected: 'danger',
  missing: 'warning',
};

const LABEL_BY_STATUS: Record<string, string> = {
  pending: 'En cours',
  fulfilled: 'Disponible',
  rejected: 'Refusé',
  missing: 'Introuvable',
};

export const statusLabel = (status: string): string => LABEL_BY_STATUS[status] ?? status;

export const getStatusStyle = (status: string): string => pillStyle(TONE_BY_STATUS[status] ?? 'neutral');
