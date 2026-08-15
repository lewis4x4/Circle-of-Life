/**
 * Quiet Operator copy for KB seed-target rollup (`/admin/knowledge/seed-targets`).
 * Missing coverage % names the gap — never a silent em dash. Real zero stays `0%`.
 */

export const SEED_TARGETS_NO_COVERAGE_COPY = "No coverage posted";

/** Seed-target rollup coverage % — null/undefined get explicit copy; numeric zero stays `0%`. */
export function formatSeedTargetCoveragePct(coveredPct: number | null | undefined): string {
  if (coveredPct == null) return SEED_TARGETS_NO_COVERAGE_COPY;
  return `${coveredPct}%`;
}
