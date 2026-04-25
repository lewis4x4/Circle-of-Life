export const tokens = {
  color: {
    bg: {
      app: "rgb(11 16 28)",
      surface: "rgb(18 25 40)",
      surfaceElevated: "rgb(25 33 50)",
      surfaceSubtle: "rgb(15 21 34)",
      border: "rgb(39 51 74)",
      borderStrong: "rgb(56 72 101)",
    },
    text: {
      primary: "rgb(237 242 251)",
      secondary: "rgb(160 176 201)",
      muted: "rgb(115 132 158)",
      inverse: "rgb(11 16 28)",
    },
    semantic: {
      success: "rgb(34 197 94)",
      info: "rgb(59 130 246)",
      warning: "rgb(245 158 11)",
      danger: "rgb(239 68 68)",
      regulatory: "rgb(139 92 246)",
      neutral: "rgb(100 116 139)",
    },
    brand: {
      primary: "rgb(59 130 246)",
      primaryHover: "rgb(37 99 235)",
      accent: "rgb(139 92 246)",
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
      sans: "'Inter', system-ui, sans-serif",
      mono: "'JetBrains Mono', 'IBM Plex Mono', monospace",
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
    card: "0 1px 2px rgba(0,0,0,0.2), 0 0 0 1px rgb(39 51 74)",
    panel: "0 4px 16px rgba(0,0,0,0.3), 0 0 0 1px rgb(39 51 74)",
    popover: "0 8px 32px rgba(0,0,0,0.5), 0 0 0 1px rgb(56 72 101)",
  },
  motion: {
    fast: "120ms",
    base: "180ms",
    slow: "260ms",
    ease: "cubic-bezier(0.4, 0, 0.2, 1)",
  },
} as const;

export type DesignTokens = typeof tokens;
