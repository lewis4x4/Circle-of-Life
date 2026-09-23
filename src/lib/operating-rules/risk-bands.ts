/**
 * Nightly risk score levels from the `risk.score_bands` operating rule
 * (COL-710, migration 489). The cut-offs are data, not code: an owner or org
 * admin sets them on Settings → Threshold targets.
 *
 * The nightly scorer (`supabase/functions/risk-nightly-scorer`) imports this
 * file directly, so the page and the scorer cannot disagree. Keep it free of
 * imports so Deno can load it.
 */

export type RiskLevel = "low" | "moderate" | "high" | "critical";

export type RiskScoreBands = {
  /** Scores below this are critical. */
  critical_below: number;
  /** Scores below this (and not critical) are high. */
  high_below: number;
  /** Scores below this (and not high) are moderate; the rest are low. */
  moderate_below: number;
};

function isWholeScore(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 100;
}

/** The rule value as stored, or null when it is not a valid set of rising bands. */
export function parseRiskScoreBands(value: unknown): RiskScoreBands | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  const { critical_below, high_below, moderate_below } = v;
  if (!isWholeScore(critical_below) || !isWholeScore(high_below) || !isWholeScore(moderate_below)) return null;
  if (!(critical_below < high_below && high_below < moderate_below)) return null;
  return { critical_below, high_below, moderate_below };
}

export function riskLevelFromBands(score: number, bands: RiskScoreBands): RiskLevel {
  if (score < bands.critical_below) return "critical";
  if (score < bands.high_below) return "high";
  if (score < bands.moderate_below) return "moderate";
  return "low";
}

/** What an executive alert records as the breach threshold (inclusive upper scores). */
export function riskAlertThresholdJson(bands: RiskScoreBands) {
  return {
    alert_level: "high" as const,
    score_lte: bands.high_below - 1,
    critical_score_lte: bands.critical_below - 1,
  };
}
