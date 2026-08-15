/**
 * Quiet Operator copy for the vendors hub (`/admin/vendors`) KPI tiles.
 * Copy reflects real data gaps — never fabricates vendor, alert, or spend totals.
 */

import { formatUsdFromCents } from "@/lib/insurance/format-money";

export type VendorsHubKpiKey = "vendor_count" | "open_alerts" | "mtd_spend";

export type VendorsHubKpiContext = {
  organizationId: string | null;
  /** Overview query failed for the current organization scope. */
  loadFailed: boolean;
};

const NOT_LOADED_COPY: Record<VendorsHubKpiKey, string> = {
  vendor_count: "Vendor count not loaded yet",
  open_alerts: "Open alert count not loaded yet",
  mtd_spend: "MTD spend not loaded yet",
};

/** One-line reason a KPI tile is empty instead of showing a count or amount. */
export function vendorsHubKpiEmptyCopy(
  key: VendorsHubKpiKey,
  ctx: VendorsHubKpiContext,
): string {
  if (!ctx.organizationId) {
    return "Organization not on profile";
  }
  if (ctx.loadFailed) {
    return "Vendor counts did not load";
  }
  return NOT_LOADED_COPY[key];
}

/** Count KPI tile body — real zeros stay numeric; null/missing gets explicit copy. */
export function vendorsHubKpiTileValue(
  key: "vendor_count" | "open_alerts",
  value: number | null,
  ctx: VendorsHubKpiContext,
): string | number {
  if (value !== null) return value;
  return vendorsHubKpiEmptyCopy(key, ctx);
}

/** MTD spend KPI tile body — real zero stays formatted; null/missing gets explicit copy. */
export function vendorsHubMtdSpendTileValue(
  value: number | null,
  ctx: VendorsHubKpiContext,
): string {
  if (value !== null) return formatUsdFromCents(value);
  return vendorsHubKpiEmptyCopy("mtd_spend", ctx);
}
