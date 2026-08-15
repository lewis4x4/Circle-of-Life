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
