/**
 * Quiet Operator copy for the finance overview (`/admin/finance`) KPI tiles.
 * Copy reflects real data gaps — never fabricates posted or unposted counts.
 */

export type FinanceOverviewKpiKey = "posted_count" | "unposted_invoices";

export type FinanceOverviewKpiContext = {
  /** Overview query failed for the current organization scope. */
  loadFailed: boolean;
};

const NOT_LOADED_COPY: Record<FinanceOverviewKpiKey, string> = {
  posted_count: "Posted count not loaded yet",
  unposted_invoices: "Unposted invoice count not loaded yet",
};

/** One-line reason a KPI tile is empty instead of showing a count. */
export function financeOverviewKpiEmptyCopy(
  key: FinanceOverviewKpiKey,
  ctx: FinanceOverviewKpiContext,
): string {
  if (ctx.loadFailed) {
    return "Finance counts did not load";
  }
  return NOT_LOADED_COPY[key];
}

/** KPI tile body — real zeros stay numeric; null/missing gets explicit copy. */
export function financeOverviewKpiTileValue(
  key: FinanceOverviewKpiKey,
  value: number | null,
  ctx: FinanceOverviewKpiContext,
): string | number {
  if (value !== null) return value;
  return financeOverviewKpiEmptyCopy(key, ctx);
}
