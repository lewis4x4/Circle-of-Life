import type { Config } from "tailwindcss";
import { tokens } from "./src/design-system/tokens";

const config: Config = {
  theme: {
    extend: {
      colors: {
        app: tokens.color.bg.app,
        surface: tokens.color.bg.surface,
        "surface-elevated": tokens.color.bg.surfaceElevated,
        "surface-subtle": tokens.color.bg.surfaceSubtle,
        border: tokens.color.bg.border,
        "border-strong": tokens.color.bg.borderStrong,
        "text-primary": tokens.color.text.primary,
        "text-secondary": tokens.color.text.secondary,
        "text-muted": tokens.color.text.muted,
        "text-inverse": tokens.color.text.inverse,
        success: tokens.color.semantic.success,
        info: tokens.color.semantic.info,
        warning: tokens.color.semantic.warning,
        danger: tokens.color.semantic.danger,
        regulatory: tokens.color.semantic.regulatory,
        neutral: tokens.color.semantic.neutral,
        "brand-primary": tokens.color.brand.primary,
        "brand-primary-hover": tokens.color.brand.primaryHover,
        "brand-accent": tokens.color.brand.accent,
      },
      spacing: tokens.space,
      fontFamily: {
        sans: [tokens.font.family.sans],
        mono: [tokens.font.family.mono],
      },
      fontSize: tokens.font.size,
      fontWeight: tokens.font.weight,
      letterSpacing: tokens.font.tracking,
      borderRadius: tokens.radius,
      boxShadow: tokens.shadow,
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
