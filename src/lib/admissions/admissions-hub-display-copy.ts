/**
 * Quiet Operator copy for the admin admissions hub (`/admin/admissions`).
 * Empty states name real gaps — never fabricate applicants, move-ins, dates, or counts.
 */

export const ADMISSIONS_HUB_MISSING_DATE_COPY = "No date posted";

export type AdmissionsHubMetricContext = {
  noFacility: boolean;
  loading: boolean;
};

/** Relative activity label for hub cards — never returns an em dash. */
export function formatAdmissionsHubRelativeDate(
  date: string | null | undefined,
  referenceDate: Date = new Date(),
): string {
  if (!date || !date.trim()) return ADMISSIONS_HUB_MISSING_DATE_COPY;
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return ADMISSIONS_HUB_MISSING_DATE_COPY;

  const diffMs = referenceDate.getTime() - d.getTime();
  const diffMins = Math.floor(diffMs / 60_000);
  const diffHours = Math.floor(diffMs / 3_600_000);
  const diffDays = Math.floor(diffMs / 86_400_000);

  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** Metric strip when the header facility selector has no valid site. */
export function admissionsHubMetricNoFacilityCopy(): string {
  return "Select a facility";
}

/** Metric strip while hub bootstrap is in flight. */
export function admissionsHubMetricLoadingCopy(): string {
  return "Loading…";
}

/** Resolve a hub KPI tile value — real zeros stay numeric once loaded. */
export function admissionsHubMetricValue(
  value: number,
  ctx: AdmissionsHubMetricContext,
): string | number {
  if (ctx.noFacility) return admissionsHubMetricNoFacilityCopy();
  if (ctx.loading) return admissionsHubMetricLoadingCopy();
  return value;
}

/** Scheduled conference date on a card — never invents a calendar day. */
export function formatAdmissionsHubConferenceScheduledDate(
  scheduledStart: string | null | undefined,
): string {
  if (!scheduledStart || !scheduledStart.trim()) return "No date scheduled";
  const d = new Date(scheduledStart);
  if (Number.isNaN(d.getTime())) return "No date scheduled";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** Medicaid pipeline stage when the field is unset on a case row. */
export function formatAdmissionsHubMedicaidStage(stage: string | null | undefined): string {
  if (!stage || !stage.trim()) return "Not set";
  return stage;
}

/** Target move-in line on an admission card. */
export function formatAdmissionsHubTargetMoveInDate(
  targetMoveInDate: string | null | undefined,
): string {
  if (!targetMoveInDate || !targetMoveInDate.trim()) return "No target move-in date";
  return `Target: ${targetMoveInDate}`;
}

/** Target move-in value when a field label already names the date. */
export function formatAdmissionsHubTargetMoveInDateValue(
  targetMoveInDate: string | null | undefined,
): string {
  if (!targetMoveInDate || !targetMoveInDate.trim()) return "No target move-in date";
  return targetMoveInDate;
}

/** Referral source on a lead or handoff card — never invents a source name. */
export function formatAdmissionsHubReferralSource(
  sourceName: string | null | undefined,
): string {
  if (!sourceName || !sourceName.trim()) return "No source";
  return sourceName;
}

export const ADMISSIONS_HUB_NO_RESIDENT_COPY = "No resident posted";
export const ADMISSIONS_HUB_NO_NAME_COPY = "No name posted";

export type AdmissionsHubResidentNameJoin = {
  first_name: string;
  last_name: string;
} | null | undefined;

const ADMISSIONS_HUB_PLACEHOLDER_RESIDENT_NAMES = new Set([
  "—",
  "unknown",
  "unknown resident",
  "unnamed",
  "unnamed resident",
]);

/** Resident name on triage and conference cards — never invents a person. */
export function formatAdmissionsHubResidentName(
  resident: AdmissionsHubResidentNameJoin,
): string {
  if (!resident) return ADMISSIONS_HUB_NO_RESIDENT_COPY;

  const first = (resident.first_name ?? "").trim();
  const last = (resident.last_name ?? "").trim();
  const combined = [first, last].filter((part) => part.length > 0).join(" ");

  if (!combined) return ADMISSIONS_HUB_NO_NAME_COPY;
  if (ADMISSIONS_HUB_PLACEHOLDER_RESIDENT_NAMES.has(combined.toLowerCase())) {
    return ADMISSIONS_HUB_NO_NAME_COPY;
  }

  return combined;
}

/** Notice when the header facility selector has no valid site. */
export function admissionsHubNoFacilityNotice(): string {
  return "Select a facility in the header to load intake and discharge metrics.";
}

export type AdmissionsHubScopeLabel = "today" | "this week" | "this month";

/** Scope label for the empty-window notice. */
export function admissionsHubScopeLabel(scope: "today" | "week" | "month"): AdmissionsHubScopeLabel {
  if (scope === "today") return "today";
  if (scope === "week") return "this week";
  return "this month";
}

/** When every hub lane is empty inside a bounded time scope. */
export function admissionsHubScopedEmptyNotice(scopeLabel: AdmissionsHubScopeLabel): string {
  return `Nothing updated in this scope (${scopeLabel}). Historical records may sit outside this window.`;
}
