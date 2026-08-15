/**
 * Quiet Operator copy for executive league print packet metrics.
 * Names real data gaps — never fabricates risk, occupancy, or confidence.
 */

export const LEAGUE_PRINT_NO_RISK_POSTED_COPY = "No risk posted";
export const LEAGUE_PRINT_NO_OCCUPANCY_POSTED_COPY = "No occupancy posted";
export const LEAGUE_PRINT_NO_CONFIDENCE_POSTED_COPY = "No confidence posted";

function isFinitePosted(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** League print risk column — 0/100 when posted as zero; explicit gap copy when missing. */
export function formatLeaguePrintRiskScore(value: number | null | undefined): string {
  if (!isFinitePosted(value)) return LEAGUE_PRINT_NO_RISK_POSTED_COPY;
  return `${value}/100`;
}

/** League print occupancy column — 0% when posted as zero; explicit gap copy when missing. */
export function formatLeaguePrintOccupancyPct(value: number | null | undefined): string {
  if (!isFinitePosted(value)) return LEAGUE_PRINT_NO_OCCUPANCY_POSTED_COPY;
  return `${value}%`;
}

/** League print packet confidence — trimmed band when posted; explicit gap copy when missing. */
export function formatLeaguePrintConfidenceBand(value: string | null | undefined): string {
  if (value == null) return LEAGUE_PRINT_NO_CONFIDENCE_POSTED_COPY;
  const trimmed = value.trim();
  if (trimmed === "") return LEAGUE_PRINT_NO_CONFIDENCE_POSTED_COPY;
  return trimmed;
}
