/**
 * Quiet Operator copy for the admin referrals hub (`/admin/referrals`) KPI tiles and row fields.
 * Copy reflects real data gaps — never fabricates lead, pipeline, or conversion counts.
 */
import { formatDisplayDateTime } from "@/lib/format/datetime";


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
  /** Detailed roster is capped, so local counts are not complete. */
  partial?: boolean;
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
  if (ctx.partial) {
    return "Requires complete reporting";
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

const LEGACY_EMPTY_REFERRAL_SOURCE_LABELS = new Set(["unknown", "unknown source"]);

/** Referral source on a pipeline row — never invents a source name. */
export function formatReferralsHubReferralSource(
  sourceName: string | null | undefined,
): string {
  if (!sourceName || !sourceName.trim()) return "No source posted";
  const trimmed = sourceName.trim();
  if (trimmed === "—" || LEGACY_EMPTY_REFERRAL_SOURCE_LABELS.has(trimmed.toLowerCase())) {
    return "No source posted";
  }
  return trimmed;
}

export const REFERRALS_HUB_NO_TOUR_TIME_COPY = "No tour time posted";

/** Tour scheduled timestamp on hub rows — never invents a tour time. */
export function formatReferralsHubTourScheduledFor(
  tourScheduledFor: string | null | undefined,
): string {
  if (!tourScheduledFor || !tourScheduledFor.trim()) return REFERRALS_HUB_NO_TOUR_TIME_COPY;
  return formatDisplayDateTime(tourScheduledFor, { fallback: REFERRALS_HUB_NO_TOUR_TIME_COPY });
}

/**
 * HL7 inbox queue line. A count that could not be read says so instead of
 * "Pending 0, failed 0" (COL-649).
 */
export function formatReferralsHubHl7Summary(input: {
  loading: boolean;
  pending: number | null;
  failed: number | null;
}): string {
  if (input.loading) return "Loading queue counts…";
  if (input.pending === null || input.failed === null) {
    return "Queue counts could not be read. Open the inbox to see the messages directly.";
  }
  return `Pending ${input.pending}, failed ${input.failed}. Open the inbox to triage, replay, or discard messages — this count is facility-scoped.`;
}
