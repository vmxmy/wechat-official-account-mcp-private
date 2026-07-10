import { defineTheme } from '@astryxdesign/core/theme';

// Astryx 0.1.3 ships theme primitives in @astryxdesign/core.  The SaaS Web
// keeps a restrained Ziikoo theme local to avoid adding a theme package beyond
// the OpenSpec-approved Astryx dependencies.
export const ziikooTheme = defineTheme({
  name: 'ziikoo-woa',
  color: {
    accent: '#087f78',
    neutralStyle: 'neutral',
    contrast: 'standard',
  },
  typography: {
    scale: { base: 16, ratio: 1.2 },
    body: {
      family: '-apple-system',
      fallbacks: 'BlinkMacSystemFont, "SF Pro Text", "Segoe UI", "Noto Sans SC", sans-serif',
    },
    heading: {
      family: '-apple-system',
      fallbacks: 'BlinkMacSystemFont, "SF Pro Display", "Segoe UI", "Noto Sans SC", sans-serif',
      weight: 'semibold',
    },
    code: {
      family: 'SFMono-Regular',
      fallbacks: 'ui-monospace, Menlo, Monaco, Consolas, monospace',
    },
  },
  radius: { base: 7, multiplier: 0.95 },
  motion: { fast: 140, medium: 260, ratio: 0.7 },
  tokens: {
    '--color-accent': ['#087f78', '#5ed5cc'],
    '--color-accent-muted': ['#087f7824', '#5ed5cc2b'],
    '--color-on-accent': ['#ffffff', '#082f2c'],
    '--color-background-body': ['#f2f4f7', '#0b0d0e'],
    '--color-background-surface': ['#ffffff', '#1b1d1f'],
    '--color-background-card': ['#ffffff', '#1b1d1f'],
    '--color-background-popover': ['#ffffff', '#25282a'],
    '--color-background-muted': ['#1018280a', '#ffffff0d'],
    '--color-text-primary': ['#1d1d1f', '#f5f5f7'],
    '--color-text-secondary': ['#5f6368', '#a7aaad'],
    '--color-text-disabled': ['#92979d', '#656a6e'],
    '--color-text-accent': ['#056b65', '#6ee7df'],
    '--color-icon-accent': ['#087f78', '#5ed5cc'],
    '--color-border': ['#10182817', '#ffffff17'],
    '--color-border-emphasized': ['#1018282e', '#ffffff2e'],
    '--color-shadow': ['#0f172a1f', '#00000070'],
    '--color-track': ['#dfe4e8', '#35393c'],
  },
});
