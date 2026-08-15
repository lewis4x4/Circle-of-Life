/**
 * Quiet Operator copy for the knowledge coverage dashboard (`/admin/knowledge/coverage`).
 * Missing rollup KPIs and table fields name real gaps — never fabricate coverage % or counts.
 */

export type CoverageKpiKey =
  | "coverage_pct"
  | "open_gaps"
  | "stale_expired"
  | "review_overdue_count";

export type CoverageKpiContext = {
  /** Dashboard rollup query failed for the current workspace. */
  loadFailed: boolean;
};

const NOT_LOADED_COPY: Record<CoverageKpiKey, string> = {
  coverage_pct: "Coverage not loaded yet",
  open_gaps: "Gap count not loaded yet",
  stale_expired: "Stale count not loaded yet",
  review_overdue_count: "Review count not loaded yet",
};

/** One-line reason a KPI tile is empty instead of showing a count. */
export function coverageKpiEmptyCopy(key: CoverageKpiKey, ctx: CoverageKpiContext): string {
  if (ctx.loadFailed) {
    return "Knowledge counts did not load";
  }
  return NOT_LOADED_COPY[key];
}

/** Seed-target coverage % — real zero stays `0%`; null rollup gets explicit copy. */
export function coverageKpiCoveragePctValue(
  rollup: { coverage_pct: number | null } | null,
  ctx: CoverageKpiContext,
): string {
  if (!rollup) return coverageKpiEmptyCopy("coverage_pct", ctx);
  return `${rollup.coverage_pct ?? 0}%`;
}

/** Open-gap count — real zero stays numeric. */
export function coverageKpiOpenGapsValue(
  rollup: { open_gaps: number } | null,
  ctx: CoverageKpiContext,
): string | number {
  if (!rollup) return coverageKpiEmptyCopy("open_gaps", ctx);
  return rollup.open_gaps;
}

/** Stale + expired document count — real zero stays numeric. */
export function coverageKpiStaleExpiredValue(
  rollup: { stale_documents: number; expired_documents: number } | null,
  ctx: CoverageKpiContext,
): string | number {
  if (!rollup) return coverageKpiEmptyCopy("stale_expired", ctx);
  return rollup.stale_documents + rollup.expired_documents;
}

/** Review-overdue count — real zero stays numeric. */
export function coverageKpiReviewOverdueValue(
  rollup: { review_overdue_count: number } | null,
  ctx: CoverageKpiContext,
): string | number {
  if (!rollup) return coverageKpiEmptyCopy("review_overdue_count", ctx);
  return rollup.review_overdue_count;
}

export const COVERAGE_NO_COMPLIANCE_CATEGORY_COPY = "No category posted";
export const COVERAGE_NO_REFRESH_AGE_COPY = "No refresh age posted";
export const COVERAGE_REVIEW_NOT_OVERDUE_COPY = "Review not overdue";

/** Compliance category on a freshness row when unset or blank. */
export function formatCoverageComplianceCategory(category: string | null | undefined): string {
  if (!category || !category.trim()) return COVERAGE_NO_COMPLIANCE_CATEGORY_COPY;
  return category;
}

/** Days since last refresh — real zero stays numeric; null names the gap. */
export function formatCoverageDaysSinceRefresh(days: number | null | undefined): string | number {
  if (days == null) return COVERAGE_NO_REFRESH_AGE_COPY;
  return days;
}

/** Review column when the document is not overdue (muted fallback vs Overdue badge). */
export function formatCoverageReviewStatus(reviewOverdue: boolean): string {
  if (reviewOverdue) return "Overdue";
  return COVERAGE_REVIEW_NOT_OVERDUE_COPY;
}
