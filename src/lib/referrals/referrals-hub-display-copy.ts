/**
 * Quiet Operator copy for the admin referrals hub (`/admin/referrals`) KPI tiles and row fields.
 * Copy reflects real data gaps — never fabricates lead, pipeline, or conversion counts.
 */

export type ReferralsHubKpiKey =
  | "new_leads"
  | "active_pipeline"
  | "needs_attention"
  | "conversions"
  | "in_admissions";

export type ReferralsHubKpiContext = {
  /** Hub bootstrap or refresh is in flight. */
  loading: boolean;
  /** Bootstrap query failed for the current facility scope. */
  loadFailed: boolean;
};

const NOT_LOADED_COPY: Record<ReferralsHubKpiKey, string> = {
  new_leads: "Lead count not loaded yet",
  active_pipeline: "Pipeline count not loaded yet",
  needs_attention: "Attention count not loaded yet",
  conversions: "Conversion count not loaded yet",
  in_admissions: "Admissions count not loaded yet",
};

/** One-line reason a KPI tile is empty instead of showing a count. */
export function referralsHubKpiEmptyCopy(
  key: ReferralsHubKpiKey,
  ctx: ReferralsHubKpiContext,
): string {
  if (ctx.loadFailed) {
    return "Referral counts did not load";
  }
  return NOT_LOADED_COPY[key];
}

/** KPI tile body — real zeros stay numeric; loading and missing get explicit copy. */
export function referralsHubKpiTileValue(
  key: ReferralsHubKpiKey,
  value: number | null | undefined,
  ctx: ReferralsHubKpiContext,
): string | number {
  if (ctx.loading) return "Loading";
  if (ctx.loadFailed) return "Referral counts did not load";
  if (value !== null && value !== undefined) return value;
  return referralsHubKpiEmptyCopy(key, ctx);
}

/** Outreach activity week when no scheduled timestamp is posted. */
export function formatReferralsHubOutreachWeek(
  performedForWeek: string | null | undefined,
): string {
  if (!performedForWeek || !performedForWeek.trim()) return "No week posted";
  return performedForWeek;
}

/** Referral source on a pipeline row — never invents a source name. */
export function formatReferralsHubReferralSource(
  sourceName: string | null | undefined,
): string {
  if (!sourceName || !sourceName.trim()) return "No source posted";
  return sourceName;
}
