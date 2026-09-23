/**
 * Quiet Operator copy for the finance overview (`/admin/finance`) KPI tiles.
 * Copy reflects real data gaps — never fabricates posted or unposted counts.
 */

import { canClaimAllClear } from "@/lib/metrics/metric-state";

export type FinanceOverviewKpiKey = "posted_count" | "unposted_invoices";

export type FinanceOverviewKpiContext = {
  /** Overview query failed for the current organization scope. */
  loadFailed: boolean;
  /** The overview loader returned; a null count after this means that count's read failed. */
  countsLoaded?: boolean;
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
  if (ctx.countsLoaded) {
    return "Count did not load";
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

export type FinanceLedgerQueueState =
  | { kind: "reconciled" }
  | { kind: "unposted"; count: number }
  | { kind: "no_sent_invoices" }
  | { kind: "unavailable" };

/**
 * Action-ledger panel (COL-649). "Ledger reconciled" is only true when the
 * sent-invoice count and the posted-source read both succeeded, there was at
 * least one sent invoice to reconcile, and none is unposted.
 */
export function financeLedgerQueueState(input: {
  unpostedInvoices: number | null;
  sentInvoices: number | null;
  loadFailed: boolean;
}): FinanceLedgerQueueState {
  if (input.loadFailed || input.unpostedInvoices === null || input.sentInvoices === null) {
    return { kind: "unavailable" };
  }
  if (input.unpostedInvoices > 0) return { kind: "unposted", count: input.unpostedInvoices };
  if (canClaimAllClear({ scopeSize: input.sentInvoices, issueCount: input.unpostedInvoices })) {
    return { kind: "reconciled" };
  }
  return { kind: "no_sent_invoices" };
}
