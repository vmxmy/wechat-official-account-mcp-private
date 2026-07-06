import { defineTheme } from '@astryxdesign/core/theme';

// Astryx 0.1.3 ships theme primitives in @astryxdesign/core.  The SaaS Web
// keeps a restrained Ziikoo theme local to avoid adding a theme package beyond
// the OpenSpec-approved Astryx dependencies.
export const ziikooTheme = defineTheme({
  name: 'ziikoo-woa',
  color: {
    accent: '#1f6f78',
    neutralStyle: 'neutral',
    contrast: 'standard',
  },
  typography: {
    scale: { base: 15, ratio: 1.18 },
    body: {
      family: 'Inter',
      fallbacks: '-apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans SC", sans-serif',
    },
    heading: {
      family: 'Inter',
      fallbacks: '-apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans SC", sans-serif',
      weight: 'semibold',
    },
    code: {
      family: 'JetBrains Mono',
      fallbacks: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
    },
  },
  radius: { base: 6, multiplier: 0.9 },
  motion: { fast: 180, medium: 260, ratio: 0.75 },
  tokens: {
    '--color-accent': ['#1f6f78', '#5ab8c2'],
  },
});
