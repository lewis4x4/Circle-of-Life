import type { Config } from "tailwindcss";
import { tokens } from "./src/design-system/tokens";

const config: Config = {
  darkMode: "class",
  theme: {
    container: {
      center: false,
      padding: "0",
    },
    extend: {
      colors: {
        /* HSL token-driven semantic palette — the single source of truth.
           Components should reach for these names: bg-background, text-foreground,
           border-border, bg-card, bg-muted, text-muted-foreground, etc. */
        background: "hsl(var(--background) / <alpha-value>)",
        foreground: "hsl(var(--foreground) / <alpha-value>)",
        card: {
          DEFAULT: "hsl(var(--card) / <alpha-value>)",
          foreground: "hsl(var(--card-foreground) / <alpha-value>)",
        },
        popover: {
          DEFAULT: "hsl(var(--popover) / <alpha-value>)",
          foreground: "hsl(var(--popover-foreground) / <alpha-value>)",
        },
        primary: {
          DEFAULT: "hsl(var(--primary) / <alpha-value>)",
          foreground: "hsl(var(--primary-foreground) / <alpha-value>)",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary) / <alpha-value>)",
          foreground: "hsl(var(--secondary-foreground) / <alpha-value>)",
        },
        muted: {
          DEFAULT: "hsl(var(--muted) / <alpha-value>)",
          foreground: "hsl(var(--muted-foreground) / <alpha-value>)",
        },
        accent: {
          DEFAULT: "hsl(var(--accent) / <alpha-value>)",
          foreground: "hsl(var(--accent-foreground) / <alpha-value>)",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive) / <alpha-value>)",
          foreground: "hsl(var(--destructive-foreground) / <alpha-value>)",
        },
        success: "hsl(var(--success) / <alpha-value>)",
        warning: "hsl(var(--warning) / <alpha-value>)",
        info: "hsl(var(--info) / <alpha-value>)",
        border: "hsl(var(--border) / <alpha-value>)",
        input: "hsl(var(--input) / <alpha-value>)",
        ring: "hsl(var(--ring) / <alpha-value>)",
        chart: {
          1: "hsl(var(--chart-1) / <alpha-value>)",
          2: "hsl(var(--chart-2) / <alpha-value>)",
          3: "hsl(var(--chart-3) / <alpha-value>)",
          4: "hsl(var(--chart-4) / <alpha-value>)",
          5: "hsl(var(--chart-5) / <alpha-value>)",
        },
        sidebar: {
          DEFAULT: "hsl(var(--sidebar) / <alpha-value>)",
          foreground: "hsl(var(--sidebar-foreground) / <alpha-value>)",
          primary: "hsl(var(--sidebar-primary) / <alpha-value>)",
          "primary-foreground":
            "hsl(var(--sidebar-primary-foreground) / <alpha-value>)",
          accent: "hsl(var(--sidebar-accent) / <alpha-value>)",
          "accent-foreground":
            "hsl(var(--sidebar-accent-foreground) / <alpha-value>)",
          border: "hsl(var(--sidebar-border) / <alpha-value>)",
          ring: "hsl(var(--sidebar-ring) / <alpha-value>)",
        },

        /* Legacy design-system aliases — preserved so v2 templates that import
           tokens.ts (PageShell, KPITile, etc.) keep rendering. New code should
           prefer the semantic names above. */
        app: tokens.color.bg.app,
        surface: tokens.color.bg.surface,
        "surface-elevated": tokens.color.bg.surfaceElevated,
        "surface-subtle": tokens.color.bg.surfaceSubtle,
        "border-strong": tokens.color.bg.borderStrong,
        "text-primary": tokens.color.text.primary,
        "text-secondary": tokens.color.text.secondary,
        "text-muted": tokens.color.text.muted,
        "text-inverse": tokens.color.text.inverse,
        regulatory: tokens.color.semantic.regulatory,
        neutral: tokens.color.semantic.neutral,
        "brand-primary": tokens.color.brand.primary,
        "brand-primary-hover": tokens.color.brand.primaryHover,
        "brand-accent": tokens.color.brand.accent,
      },
      borderRadius: {
        ...tokens.radius,
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
        xl: "calc(var(--radius) + 4px)",
        "2xl": "calc(var(--radius) + 8px)",
      },
      spacing: tokens.space,
      fontFamily: {
        sans: ["var(--font-inter)", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: [tokens.font.family.mono],
        display: ["var(--font-inter)", "ui-sans-serif", "system-ui", "sans-serif"],
      },
      fontSize: tokens.font.size,
      fontWeight: tokens.font.weight,
      letterSpacing: tokens.font.tracking,
      boxShadow: {
        ...tokens.shadow,
        soft: "0 1px 2px rgb(15 23 42 / 0.04), 0 1px 1px rgb(15 23 42 / 0.06)",
        elevated:
          "0 4px 12px rgb(15 23 42 / 0.06), 0 1px 3px rgb(15 23 42 / 0.04)",
      },
      transitionDuration: {
        fast: tokens.motion.fast,
        base: tokens.motion.base,
        slow: tokens.motion.slow,
      },
      transitionTimingFunction: {
        "ui-v2": tokens.motion.ease,
      },
    },
  },
};

export default config;
