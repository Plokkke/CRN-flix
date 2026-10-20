// Inline styles and table-based layouts: emails need them, web pages reuse them.
// Color palette
export const COLORS = {
  // Brand colors
  primary: '#1e1e2a',
  secondary: '#e50914',

  // Status colors
  success: '#32cd32',
  warning: '#ffd700',
  error: '#ff4444',
  info: '#1e90ff',
  gray: '#808080',
  orange: '#ff8c00',

  // UI colors
  background: '#f7f7f7',
  white: '#ffffff',
  text: '#333333',
  textLight: '#666666',
  textMuted: '#888888',
  border: '#e0e0e0',
  borderLight: '#eeeeee',
  footerBg: '#f5f5f5',
  footerText: '#777777',
} as const;

// Typography styles (inline)
export const TYPOGRAPHY = {
  h1: 'font-size: 24px; font-weight: bold; color: #1e1e2a; margin: 0 0 20px 0; line-height: 1.2;',
  h2: 'font-size: 20px; font-weight: bold; color: #1e1e2a; margin: 20px 0 15px 0; line-height: 1.3;',
  h3: 'font-size: 18px; font-weight: bold; color: #1e1e2a; margin: 15px 0 10px 0; line-height: 1.3;',
  body: 'font-size: 16px; color: #333333; line-height: 1.6; margin: 0 0 15px 0;',
  small: 'font-size: 14px; color: #666666; line-height: 1.5;',
  muted: 'font-size: 14px; color: #888888; line-height: 1.5;',
} as const;

// Button styles
export const BUTTONS = {
  primary: `display: inline-block; padding: 12px 25px; background-color: ${COLORS.secondary}; color: white; text-decoration: none; border-radius: 5px; font-weight: bold; font-size: 16px; text-align: center;`,
  secondary: `display: inline-block; padding: 12px 25px; background-color: ${COLORS.primary}; color: white; text-decoration: none; border-radius: 5px; font-weight: bold; font-size: 16px; text-align: center;`,
} as const;

// Status badge styles
export const getStatusStyle = (status: string): string => {
  const statusColors: Record<string, { bg: string; text: string }> = {
    pending: { bg: COLORS.warning, text: '#000000' },
    fulfilled: { bg: COLORS.success, text: '#ffffff' },
    rejected: { bg: COLORS.error, text: '#ffffff' },
    missing: { bg: COLORS.orange, text: '#ffffff' },
  };

  const colors = statusColors[status] || { bg: COLORS.gray, text: '#ffffff' };
  return `display: inline-block; padding: 6px 12px; border-radius: 4px; font-weight: bold; background-color: ${colors.bg}; color: ${colors.text}; font-size: 14px;`;
};
