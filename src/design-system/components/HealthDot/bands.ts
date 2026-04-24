export const HEALTH_DOT_BANDS = [
  { min: 80, tone: "success" as const },
  { min: 65, tone: "warning" as const },
  { min: 0, tone: "danger" as const },
];

export type HealthDotTone = (typeof HEALTH_DOT_BANDS)[number]["tone"];

export function resolveHealthBand(score: number, max = 100): HealthDotTone {
  const normalized = Math.max(0, Math.min(score, max));
  const pct = max === 0 ? 0 : (normalized / max) * 100;
  for (const band of HEALTH_DOT_BANDS) {
    if (pct >= band.min) return band.tone;
  }
  return "danger";
}
