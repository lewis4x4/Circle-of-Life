export const tokens = {
  color: {
    bg: {
      app: "#0B0B09",
      surface: "#161613",
      surfaceElevated: "#1A1A17",
      surfaceSubtle: "#0F0F0D",
      border: "rgba(255,255,255,0.06)",
      borderStrong: "rgba(255,255,255,0.12)",
    },
    text: {
      primary: "#F5F2EA",
      secondary: "#C5C0B5",
      muted: "#928E85",
      inverse: "#1A0F08",
    },
    semantic: {
      success: "#7A9B5E",
      info: "#6A8FA8",
      warning: "#D49B5C",
      danger: "#C26152",
      regulatory: "rgb(139 92 246)",
      neutral: "#928E85",
    },
    brand: {
      primary: "#678fab",
      primaryHover: "#779fbb",
      accent: "#436b87",
    },
  },
  radius: {
    sm: "6px",
    md: "8px",
    lg: "12px",
    xl: "16px",
    full: "9999px",
  },
  space: {
    1: "4px",
    2: "8px",
    3: "12px",
    4: "16px",
    5: "20px",
    6: "24px",
    8: "32px",
    10: "40px",
    12: "48px",
  },
  font: {
    family: {
      sans: "'Geist Sans', system-ui, sans-serif",
      mono: "'Geist Mono', ui-monospace, monospace",
    },
    size: {
      xs: "11px",
      sm: "12px",
      base: "14px",
      md: "15px",
      lg: "18px",
      xl: "22px",
      "2xl": "28px",
      "3xl": "36px",
      hero: "48px",
    },
    weight: {
      regular: 400,
      medium: 500,
      semibold: 600,
      bold: 700,
    },
    tracking: {
      tight: "-0.01em",
      normal: "0",
      wide: "0.02em",
      caps: "0.08em",
    },
  },
  shadow: {
    card: "0 1px 0 rgba(255, 255, 255, 0.04) inset, 0 16px 36px -20px rgba(0, 0, 0, 0.5)",
    panel: "0 1px 0 rgba(255, 255, 255, 0.06) inset, 0 28px 56px -24px rgba(0, 0, 0, 0.7)",
    popover: "0 0 0 1px rgba(103, 143, 171, 0.4), 0 0 24px rgba(103, 143, 171, 0.18)",
  },
  motion: {
    fast: "160ms",
    base: "240ms",
    slow: "360ms",
    ease: "cubic-bezier(0.16, 1, 0.3, 1)",
  },
} as const;

export type DesignTokens = typeof tokens;
