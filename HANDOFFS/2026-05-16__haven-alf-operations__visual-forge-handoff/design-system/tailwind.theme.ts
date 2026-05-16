import type { Config } from 'tailwindcss';

const theme: Config['theme'] = {
  extend: {
    colors: {
      'bg': 'var(--bg)',
      'surface': 'var(--surface)',
      'surface_raised': 'var(--surface-raised)',
      'border_subtle': 'var(--border-subtle)',
      'border_strong': 'var(--border-strong)',
      'border_accent': 'var(--border-accent)',
      'text_primary': 'var(--text-primary)',
      'text_secondary': 'var(--text-secondary)',
      'text_muted': 'var(--text-muted)',
      'text_faint': 'var(--text-faint)',
      'text_on_accent': 'var(--text-on-accent)',
      'accent': 'var(--accent)',
      'accent_hover': 'var(--accent-hover)',
      'accent_deep': 'var(--accent-deep)',
      'accent_glow': 'var(--accent-glow)',
      'accent_glow_strong': 'var(--accent-glow-strong)',
      'highlight': 'var(--highlight)',
      'success': 'var(--success)',
      'warning': 'var(--warning)',
      'danger': 'var(--danger)',
      'info': 'var(--info)',
    },
    fontFamily: {
      sans: ['Geist Sans', 'system-ui', 'sans-serif'],
      mono: ['Geist Mono', 'ui-monospace', 'monospace'],
    },
    spacing: {
      '1': 'var(--space-1)',
      '2': 'var(--space-2)',
      '3': 'var(--space-3)',
      '4': 'var(--space-4)',
      '5': 'var(--space-5)',
      '6': 'var(--space-6)',
      '7': 'var(--space-7)',
      '8': 'var(--space-8)',
      '9': 'var(--space-9)',
    },
    borderRadius: {
      sm: 'var(--radius-sm)',
      DEFAULT: 'var(--radius)',
      md: 'var(--radius-md)',
      lg: 'var(--radius-lg)',
      xl: 'var(--radius-xl)',
    },
    boxShadow: {
      card: 'var(--shadow-card)',
      lift: 'var(--shadow-lift)',
      glow: 'var(--shadow-glow)',
    },
    transitionTimingFunction: {
      out: 'cubic-bezier(0.16, 1, 0.3, 1)',
      snap: 'cubic-bezier(0.4, 0, 0.2, 1)',
    },
  },
};

export default theme;
