/**
 * Tailwind semantic color keys for chrome tokens (reference).
 * Authoritative mappings: `tailwind.config.ts` `theme.extend.colors` and
 * `src/app/globals.css` `@theme inline` (`--color-chrome-*`).
 */
export const chromeTailwindColors = {
  "chrome-primary": "hsl(var(--chrome-primary) / <alpha-value>)",
  "chrome-secondary": "hsl(var(--chrome-secondary) / <alpha-value>)",
  "chrome-foreground": "hsl(var(--chrome-foreground) / <alpha-value>)",
  "chrome-foreground-muted": "hsl(var(--chrome-foreground-muted) / <alpha-value>)",
  "chrome-active": "hsl(var(--chrome-active) / <alpha-value>)",
} as const;

export const chromeRingOffsetColors = {
  "chrome-primary": "hsl(var(--chrome-primary))",
  "chrome-secondary": "hsl(var(--chrome-secondary))",
} as const;
