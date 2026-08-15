/**
 * Quiet Operator copy for the insurance hub (`/admin/insurance`) KPI tiles.
 * Copy reflects real data gaps — never fabricates policy, renewal, or claim counts.
 */

export type InsuranceHubKpiKey = "active_policies" | "renewals_in_flight" | "open_claims";

export type InsuranceHubKpiContext = {
  organizationId: string | null;
  /** Overview query failed for the current organization scope. */
  loadFailed: boolean;
};

const NOT_LOADED_COPY: Record<InsuranceHubKpiKey, string> = {
  active_policies: "Policy count not loaded yet",
  renewals_in_flight: "Renewal count not loaded yet",
  open_claims: "Claim count not loaded yet",
};

/** One-line reason a KPI tile is empty instead of showing a count. */
export function insuranceHubKpiEmptyCopy(
  key: InsuranceHubKpiKey,
  ctx: InsuranceHubKpiContext,
): string {
  if (!ctx.organizationId) {
    return "Organization not on profile";
  }
  if (ctx.loadFailed) {
    return "Insurance counts did not load";
  }
  return NOT_LOADED_COPY[key];
}

/** KPI tile body — real zeros stay numeric; null/missing gets explicit copy. */
export function insuranceHubKpiTileValue(
  key: InsuranceHubKpiKey,
  value: number | null,
  ctx: InsuranceHubKpiContext,
): string | number {
  if (value !== null) return value;
  return insuranceHubKpiEmptyCopy(key, ctx);
}
