/**
 * Which posted rate schedule applies to a facility on a day (COL-666).
 *
 * A schedule carries every tier (private, semi-private/companion, care levels),
 * so "per facility and tier" resolves per facility. A schedule is in force from
 * its effective date through its end date; drafts and rows that end before they
 * begin are never in force. The overlap rule itself is a business decision and
 * lives in `billing_rate_rules` (migration 477), mirrored here from
 * `public.haven_billing_rate_rule` so the page and the database agree:
 *
 * - `single_in_force` — only one schedule may be in force. The database refuses
 *   a second; if old data still has two, the page names the conflict instead of
 *   picking one.
 * - `latest_effective_wins` — the in-force schedule with the latest effective
 *   date applies.
 *
 * With no rule row the stricter `single_in_force` applies, as in the database.
 */

export type RateOverlapRule = "single_in_force" | "latest_effective_wins";

export type BillingRateRuleRow = {
  id: string;
  organization_id: string;
  facility_id: string | null;
  effective_from: string;
  rate_overlap_rule: RateOverlapRule;
  payer_split_is_concession: boolean;
  created_at: string;
};

export type ResolvedBillingRateRule = {
  rateOverlapRule: RateOverlapRule;
  payerSplitIsConcession: boolean;
  ruleId: string | null;
};

export const DEFAULT_BILLING_RATE_RULE: ResolvedBillingRateRule = {
  rateOverlapRule: "single_in_force",
  payerSplitIsConcession: false,
  ruleId: null,
};

/** The facility's own rule first, then the organization's, latest effective date first. */
export function resolveBillingRateRule(
  rules: ReadonlyArray<BillingRateRuleRow>,
  organizationId: string,
  facilityId: string,
  asOfIso: string,
): ResolvedBillingRateRule {
  const candidates = rules
    .filter(
      (rule) =>
        rule.organization_id === organizationId &&
        (rule.facility_id === facilityId || rule.facility_id == null) &&
        rule.effective_from <= asOfIso,
    )
    .sort(
      (a, b) =>
        Number(b.facility_id != null) - Number(a.facility_id != null) ||
        b.effective_from.localeCompare(a.effective_from) ||
        b.created_at.localeCompare(a.created_at),
    );
  const rule = candidates[0];
  if (!rule) return DEFAULT_BILLING_RATE_RULE;
  return {
    rateOverlapRule: rule.rate_overlap_rule,
    payerSplitIsConcession: rule.payer_split_is_concession,
    ruleId: rule.id,
  };
}

export type ScheduleDates = {
  id: string;
  effectiveDate: string;
  endDate: string | null;
  status: string;
};

export type ScheduleTimelineState = "in_force" | "upcoming" | "ended" | "never_in_force" | "draft";

export function scheduleTimelineState(schedule: ScheduleDates, asOfIso: string): ScheduleTimelineState {
  if (schedule.status === "draft") return "draft";
  if (schedule.endDate != null && schedule.endDate < schedule.effectiveDate) return "never_in_force";
  if (schedule.effectiveDate > asOfIso) return "upcoming";
  if (schedule.endDate != null && schedule.endDate < asOfIso) return "ended";
  return "in_force";
}

export const SCHEDULE_TIMELINE_LABEL: Record<ScheduleTimelineState, string> = {
  in_force: "In force",
  upcoming: "Upcoming",
  ended: "Ended",
  never_in_force: "Never in force",
  draft: "Draft",
};

export type FacilityScheduleResolution<T extends ScheduleDates> = {
  /** The schedule that applies today, or null when none does or the rule forbids choosing. */
  winner: T | null;
  /** Schedules in force together when the rule allows only one. */
  conflicting: T[];
  /** The next schedule to take effect after today, if one is published. */
  next: T | null;
};

export function resolveFacilitySchedule<T extends ScheduleDates>(
  schedules: ReadonlyArray<T>,
  asOfIso: string,
  rule: RateOverlapRule,
): FacilityScheduleResolution<T> {
  const inForce = schedules
    .filter((schedule) => scheduleTimelineState(schedule, asOfIso) === "in_force")
    .sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate));
  const next =
    schedules
      .filter((schedule) => scheduleTimelineState(schedule, asOfIso) === "upcoming")
      .sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate))[0] ?? null;
  if (inForce.length > 1 && rule === "single_in_force") {
    return { winner: null, conflicting: inForce, next };
  }
  return { winner: inForce[0] ?? null, conflicting: [], next };
}

export const RATE_OVERLAP_RULE_COPY: Record<RateOverlapRule, string> = {
  single_in_force: "One schedule in force per facility at a time",
  latest_effective_wins: "When schedules overlap, the latest effective date applies",
};
