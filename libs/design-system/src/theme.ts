// Web pages read every color from CSS variables, so one stylesheet serves both themes.
// Emails keep literal colors (tokens.ts): mail clients do not support variables.
import { COLORS, Tone, TONES } from './tokens';

export type WebTheme = 'light' | 'dark';

type ToneVars = Record<Tone, { bg: string; text: string; border: string }>;

type Palette = {
  page: string;
  surface: string;
  surfaceMuted: string;
  surfaceRaised: string;
  headerBg: string;
  inputBg: string;
  border: string;
  borderLight: string;
  heading: string;
  text: string;
  textLight: string;
  textMuted: string;
  link: string;
  tones: ToneVars;
};

const LIGHT: Palette = {
  page: COLORS.background,
  surface: COLORS.white,
  surfaceMuted: COLORS.surfaceMuted,
  surfaceRaised: COLORS.surfaceMuted,
  headerBg: COLORS.white,
  inputBg: COLORS.white,
  border: COLORS.border,
  borderLight: COLORS.borderLight,
  heading: COLORS.primary,
  text: COLORS.text,
  textLight: COLORS.textLight,
  textMuted: COLORS.textMuted,
  link: COLORS.info,
  tones: TONES,
};

/** Every text color reaches 4.5:1 (WCAG AA) on every dark surface below. */
const DARK: Palette = {
  page: '#0f0f1a',
  surface: '#1a1a2e',
  surfaceMuted: '#1e1e33',
  surfaceRaised: '#22223a',
  headerBg: '#16162a',
  inputBg: '#14142a',
  border: '#2a2a3e',
  borderLight: '#23233a',
  heading: '#f4f4f8',
  text: '#e0e0e8',
  textLight: '#c8cad6',
  textMuted: '#a1a4b8',
  link: '#8ab4ff',
  tones: {
    neutral: { bg: '#2a2a3e', text: '#d0d3e0', border: '#3a3a52' },
    info: { bg: '#1b2a4a', text: '#9dbcff', border: '#2c4580' },
    success: { bg: '#12302a', text: '#6fdcae', border: '#1f5a46' },
    warning: { bg: '#3a2a12', text: '#f5b866', border: '#6b4a17' },
    danger: { bg: '#3a1a1e', text: '#ff9d93', border: '#6e2a2a' },
  },
};

const PALETTES: Record<WebTheme, Palette> = { light: LIGHT, dark: DARK };

const kebab = (name: string): string => name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);

function declarations({ tones, ...colors }: Palette): string {
  const plain = Object.entries(colors).map(([name, value]) => `--${kebab(name)}: ${value};`);
  const tinted = Object.entries(tones).flatMap(([tone, { bg, text, border }]) => [
    `--tone-${tone}-bg: ${bg};`,
    `--tone-${tone}-text: ${text};`,
    `--tone-${tone}-border: ${border};`,
  ]);
  return [...plain, ...tinted].join(' ');
}

/** The variables of the page's theme, on the root element. */
export const themeCss = (theme: WebTheme): string =>
  `:root { ${declarations(PALETTES[theme])} color-scheme: ${theme}; }`;
