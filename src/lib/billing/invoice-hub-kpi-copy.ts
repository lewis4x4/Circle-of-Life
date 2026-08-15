/**
 * Quiet Operator copy for the invoices hub (`/admin/billing/invoices`) KPI tiles.
 * Copy reflects real data gaps — never fabricates invoice counts or money totals.
 */

import { formatUsdFromCents } from "@/lib/insurance/format-money";

export type InvoiceHubKpiKey = "in_scope" | "total_billed" | "outstanding" | "overdue";

export type InvoiceHubKpiContext = {
  /** Invoice query still in flight with no settled snapshot yet. */
  isLoading: boolean;
  /** Invoice fetch failed for the current scope. */
  loadFailed: boolean;
  /** Invoice query settled (success or empty array). */
  invoiceFetchComplete: boolean;
};

const LOADING_COPY: Record<InvoiceHubKpiKey, string> = {
  in_scope: "Loading invoice scope…",
  total_billed: "Loading billed totals…",
  outstanding: "Loading outstanding balances…",
  overdue: "Loading overdue counts…",
};

const LOAD_FAILED_COPY = "Billing data did not load";

/** One-line reason a KPI tile is empty instead of showing a metric. */
export function invoiceHubKpiEmptyCopy(
  key: InvoiceHubKpiKey,
  ctx: InvoiceHubKpiContext,
): string | null {
  if (ctx.loadFailed) return LOAD_FAILED_COPY;
  if (ctx.isLoading && !ctx.invoiceFetchComplete) return LOADING_COPY[key];
  if (!ctx.invoiceFetchComplete) return LOADING_COPY[key];
  return null;
}

/** Whether a KPI tile is showing a loaded metric (including real zeros). */
export function invoiceHubKpiTileIsMetric(display: string | number): boolean {
  return typeof display === "number";
}

/** KPI tile body for counts — real zeros stay numeric; null/missing gets explicit copy. */
export function invoiceHubKpiCountTileValue(
  key: InvoiceHubKpiKey,
  value: number | null | undefined,
  ctx: InvoiceHubKpiContext,
): string | number {
  const gap = invoiceHubKpiEmptyCopy(key, ctx);
  if (gap) return gap;
  if (value == null) return LOADING_COPY[key];
  return value;
}

/** KPI tile body for money — real $0.00 stays formatted; null/missing gets explicit copy. */
export function invoiceHubKpiMoneyTileValue(
  key: InvoiceHubKpiKey,
  cents: number | null | undefined,
  ctx: InvoiceHubKpiContext,
): string {
  const gap = invoiceHubKpiEmptyCopy(key, ctx);
  if (gap) return gap;
  if (cents == null) return LOADING_COPY[key];
  return formatUsdFromCents(cents);
}
