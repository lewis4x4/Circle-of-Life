import { riskLevelFromBands, type RiskScoreBands } from "@/lib/operating-rules/risk-bands";

/**
 * Quiet Operator copy for risk command surfaces (`/admin/risk`).
 * Missing scores and timestamps name real gaps — never fabricate values.
 */

export const RISK_NO_SCORE_POSTED_COPY = "No score posted";
export const RISK_NO_TIMESTAMP_POSTED_COPY = "No timestamp posted";

function isFiniteRiskMetric(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** Nightly or portfolio risk score — real zero stays `0/100`; missing names the gap. */
export function formatRiskScore(value: number | null | undefined): string {
  if (!isFiniteRiskMetric(value)) return RISK_NO_SCORE_POSTED_COPY;
  return `${value}/100`;
}

/** ISO timestamp on risk command rows when unset or blank. */
export function formatRiskDateTime(value: string | null | undefined): string {
  if (value == null || value.trim() === "") return RISK_NO_TIMESTAMP_POSTED_COPY;
  return new Date(value).toLocaleString();
}

/**
 * Card tone for the portfolio score. No score posted is neutral: it used to
 * fall through to green, so an unscored portfolio looked healthy (COL-649).
 * The cut-offs are the organization's `risk.score_bands` operating rule
 * (COL-710); when they could not be read the tone stays neutral rather than
 * guessing.
 */
export function riskPortfolioTone(
  value: number | null | undefined,
  bands: RiskScoreBands | null,
): "indigo" | "emerald" | "amber" | "red" {
  if (!isFiniteRiskMetric(value) || !bands) return "indigo";
  switch (riskLevelFromBands(value, bands)) {
    case "critical":
      return "red";
    case "high":
      return "amber";
    default:
      return "emerald";
  }
}

/** One line naming the bands in force, for the page to show where the colours come from. */
export function formatRiskBandsLine(bands: RiskScoreBands | null): string {
  if (!bands) return "Risk bands could not be read, so scores are not coloured.";
  return `Critical below ${bands.critical_below}, high below ${bands.high_below}, moderate below ${bands.moderate_below}. Set on Settings → Threshold targets.`;
}
