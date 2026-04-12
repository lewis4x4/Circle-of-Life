/**
 * Moonshot Theme — color palette and utilities for executive dashboards
 */

export type MoonshotColor =
  | "indigo"
  | "cyan"
  | "emerald"
  | "amber"
  | "rose"
  | "violet"
  | "blue"
  | "teal"
  | "orange"
  | "pink"
  | "slate"
  | "purple"
  | "gold";

/** Primary neon color hex values */
export const MOONSHOT_COLORS: Record<MoonshotColor, string> & { border: string; textDim: string } = {
  indigo: "#818cf8",
  cyan: "#22d3ee",
  emerald: "#34d399",
  amber: "#fbbf24",
  rose: "#fb7185",
  violet: "#a78bfa",
  blue: "#60a5fa",
  teal: "#2dd4bf",
  orange: "#fb923c",
  pink: "#f472b6",
  slate: "#94a3b8",
  purple: "#c084fc",
  gold: "#facc15",
  border: "rgba(255,255,255,0.08)",
  textDim: "rgba(148,163,184,0.6)",
};

/** Dimmed version (30% opacity feel) for backgrounds */
const DIM_COLORS: Record<MoonshotColor, string> = {
  indigo: "rgba(129,140,248,0.15)",
  cyan: "rgba(34,211,238,0.15)",
  emerald: "rgba(52,211,153,0.15)",
  amber: "rgba(251,191,36,0.15)",
  rose: "rgba(251,113,133,0.15)",
  violet: "rgba(167,139,250,0.15)",
  blue: "rgba(96,165,250,0.15)",
  teal: "rgba(45,212,191,0.15)",
  orange: "rgba(251,146,60,0.15)",
  pink: "rgba(244,114,182,0.15)",
  slate: "rgba(148,163,184,0.15)",
  purple: "rgba(192,132,252,0.15)",
  gold: "rgba(250,204,21,0.15)",
};

export function getMoonshotColor(color: MoonshotColor): string {
  return MOONSHOT_COLORS[color] ?? MOONSHOT_COLORS.indigo;
}

export function getMoonshotDimColor(color: MoonshotColor): string {
  return DIM_COLORS[color] ?? DIM_COLORS.indigo;
}

export function createGlowShadow(color: MoonshotColor): string {
  const hex = getMoonshotColor(color);
  return `0 0 20px ${hex}33, 0 0 40px ${hex}1a`;
}

export function createTextGlow(color: MoonshotColor): string {
  const hex = getMoonshotColor(color);
  return `0 0 8px ${hex}66, 0 0 16px ${hex}33`;
}

// ── Role palettes ──

export interface RolePalette {
  positive: MoonshotColor;
  growth: MoonshotColor;
  info: MoonshotColor;
  critical: MoonshotColor;
}

export const CEO_PALETTE: RolePalette = {
  positive: "emerald",
  growth: "indigo",
  info: "cyan",
  critical: "amber",
};

export const COO_PALETTE: RolePalette = {
  positive: "teal",
  growth: "cyan",
  info: "violet",
  critical: "rose",
};

export const CFO_PALETTE: RolePalette = {
  positive: "emerald",
  growth: "blue",
  info: "amber",
  critical: "orange",
};
