/**
 * Quiet Operator copy for billing overview KPI tiles and action queue when metrics are absent.
 * Copy reflects real data gaps — never fabricates AR, invoice, or payment totals.
 */

export type BillingOverviewKpiKey =
  | "outstanding_ar"
  | "ninety_plus_share"
  | "applied_period"
  | "overdue_count";

export type BillingOverviewKpiContext = {
  /** Invoice query still in flight with no rows yet. */
  isLoading: boolean;
  /** Invoice fetch failed for the current scope. */
  loadFailed: boolean;
  /** Invoice query settled (success or empty array). */
  invoiceFetchComplete: boolean;
  /** All invoices returned for the billing header scope (not period-filtered). */
  totalInvoiceRows: number;
  openArTotalCents: number;
  cohortResidentCount: number;
  periodBilledCents: number;
  periodAppliedRatePct: number | null;
  ninetyPlusSharePct: number | null;
  overdueCount: number;
};

const LOADING_COPY: Record<BillingOverviewKpiKey, string> = {
  outstanding_ar: "Loading open balances…",
  ninety_plus_share: "Loading aging buckets…",
  applied_period: "Loading invoice period…",
  overdue_count: "Loading invoice statuses…",
};

const LOAD_FAILED_COPY = "Billing data did not load";

function sharedLoadGap(
  key: BillingOverviewKpiKey,
  ctx: BillingOverviewKpiContext,
): string | null {
  if (ctx.loadFailed) return LOAD_FAILED_COPY;
  if (ctx.isLoading && !ctx.invoiceFetchComplete) return LOADING_COPY[key];
  return null;
}

/** One-line reason the outstanding AR tile is empty instead of showing a balance. */
export function billingOverviewOutstandingArEmptyCopy(ctx: BillingOverviewKpiContext): string | null {
  const loadGap = sharedLoadGap("outstanding_ar", ctx);
  if (loadGap) return loadGap;
  if (!ctx.invoiceFetchComplete) return LOADING_COPY.outstanding_ar;
  if (ctx.totalInvoiceRows === 0) {
    if (ctx.cohortResidentCount > 0) {
      return "No invoices loaded — use opening balance import";
    }
    return "No invoices in this scope";
  }
  return null;
}

/** One-line reason the 90+ share tile is empty instead of showing a percentage. */
export function billingOverviewNinetyPlusShareEmptyCopy(ctx: BillingOverviewKpiContext): string | null {
  const loadGap = sharedLoadGap("ninety_plus_share", ctx);
  if (loadGap) return loadGap;
  if (!ctx.invoiceFetchComplete) return LOADING_COPY.ninety_plus_share;
  if (ctx.openArTotalCents <= 0) return "No open AR to age";
  if (ctx.ninetyPlusSharePct == null) return "No ninety-plus bucket yet";
  return null;
}

/** One-line reason the applied-to-date tile is empty instead of showing a rate. */
export function billingOverviewAppliedPeriodEmptyCopy(ctx: BillingOverviewKpiContext): string | null {
  const loadGap = sharedLoadGap("applied_period", ctx);
  if (loadGap) return loadGap;
  if (!ctx.invoiceFetchComplete) return LOADING_COPY.applied_period;
  if (ctx.periodBilledCents === 0) return "No invoices this period";
  if (ctx.periodAppliedRatePct == null) return "Collection rate not available";
  return null;
}

/** One-line reason the overdue count tile is empty instead of showing a count. */
export function billingOverviewOverdueCountEmptyCopy(ctx: BillingOverviewKpiContext): string | null {
  const loadGap = sharedLoadGap("overdue_count", ctx);
  if (loadGap) return loadGap;
  if (!ctx.invoiceFetchComplete) return LOADING_COPY.overdue_count;
  return null;
}

/** Dispatch empty-copy lookup by KPI key. */
export function billingOverviewKpiEmptyCopy(
  key: BillingOverviewKpiKey,
  ctx: BillingOverviewKpiContext,
): string | null {
  switch (key) {
    case "outstanding_ar":
      return billingOverviewOutstandingArEmptyCopy(ctx);
    case "ninety_plus_share":
      return billingOverviewNinetyPlusShareEmptyCopy(ctx);
    case "applied_period":
      return billingOverviewAppliedPeriodEmptyCopy(ctx);
    case "overdue_count":
      return billingOverviewOverdueCountEmptyCopy(ctx);
  }
}

/** Whether a KPI tile is showing a loaded metric (including real zeros). */
export function billingOverviewKpiIsLoaded(key: BillingOverviewKpiKey, ctx: BillingOverviewKpiContext): boolean {
  return billingOverviewKpiEmptyCopy(key, ctx) == null;
}

/** Action queue line when no overdue invoices need follow-up. */
export function billingActionQueueOverdueCopy(ctx: BillingOverviewKpiContext): string {
  if (ctx.loadFailed) return "Overdue list did not load";
  if (ctx.isLoading && !ctx.invoiceFetchComplete) return "Loading overdue invoices…";
  if (ctx.totalInvoiceRows === 0) return "No invoices in scope — nothing overdue yet";
  if (ctx.overdueCount === 0) return "No overdue invoices in scope";
  return `${ctx.overdueCount} overdue invoice${ctx.overdueCount === 1 ? "" : "s"} awaiting follow-up`;
}

/** Action queue line when no draft invoices need finalization. */
export function billingActionQueueDraftCopy(draftCount: number, ctx: BillingOverviewKpiContext): string {
  if (ctx.loadFailed) return "Draft list did not load";
  if (ctx.isLoading && !ctx.invoiceFetchComplete) return "Loading draft invoices…";
  if (ctx.totalInvoiceRows === 0) return "No invoices in scope — no drafts yet";
  if (draftCount === 0) return "No draft invoices in scope";
  return `${draftCount} draft invoice${draftCount === 1 ? "" : "s"} to finalize`;
}

/** Summary line under the overview KPI strip. */
export function billingOverviewKpiStripHelperLine(ctx: BillingOverviewKpiContext): string {
  const keys: BillingOverviewKpiKey[] = [
    "outstanding_ar",
    "ninety_plus_share",
    "applied_period",
    "overdue_count",
  ];
  const loadedCount = keys.filter((key) => billingOverviewKpiIsLoaded(key, ctx)).length;
  const totalCount = keys.length;

  if (loadedCount >= totalCount) {
    return "AR snapshot loaded for the selected scope — open Invoices or Opening balance for ledger work.";
  }
  if (ctx.loadFailed) {
    return "Billing data did not load — refresh or check facility scope, then retry.";
  }
  if (loadedCount === 0) {
    return "Empty tiles name what is still missing — nothing is broken.";
  }
  return `${loadedCount} of ${totalCount} AR snapshot tiles loaded — empty tiles name what is still missing.`;
}
