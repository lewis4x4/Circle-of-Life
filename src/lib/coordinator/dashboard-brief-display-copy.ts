/**
 * Quiet Operator copy for coordinator dashboard brief resident labels and KPI tiles.
 * Missing resident rows, blank names, and missing counts name real gaps — never fabricate labels.
 */

export type CoordinatorDashboardKpiKey =
  | "active_care_plans"
  | "reviews_due_14d"
  | "pending_assessments"
  | "staff_bulletin_notes"
  | "recent_condition_changes"
  | "active_admissions";

const KPI_LOADING_COPY: Record<CoordinatorDashboardKpiKey, string> = {
  active_care_plans: "Loading care plan count…",
  reviews_due_14d: "Loading review count…",
  pending_assessments: "Loading assessment count…",
  staff_bulletin_notes: "Loading bulletin notes…",
  recent_condition_changes: "Loading condition change count…",
  active_admissions: "Loading admission count…",
};

const KPI_NO_COUNT_POSTED_COPY: Record<CoordinatorDashboardKpiKey, string> = {
  active_care_plans: "No care plan count posted",
  reviews_due_14d: "No review count posted",
  pending_assessments: "No assessment count posted",
  staff_bulletin_notes: "No bulletin notes count posted",
  recent_condition_changes: "No condition change count posted",
  active_admissions: "No admission count posted",
};

export const COORDINATOR_DASHBOARD_LOADING_HEADLINE = "Loading coordinator dashboard…";

export const COORDINATOR_DASHBOARD_CARE_PLANS_DUE_LOADING_COPY =
  "Loading care plans due…";

export const COORDINATOR_DASHBOARD_ADMISSIONS_LOADING_COPY =
  "Loading admission pipeline…";

/** KPI tile body — real zeros stay numeric; loading and missing counts get explicit copy. */
export function formatCoordinatorDashboardKpiValue(
  key: CoordinatorDashboardKpiKey,
  value: number | null | undefined,
  isLoading: boolean,
): string | number {
  if (isLoading) return KPI_LOADING_COPY[key];
  if (value == null) return KPI_NO_COUNT_POSTED_COPY[key];
  return value;
}

/** Whether a KPI tile is showing a loaded metric (including real zeros). */
export function coordinatorDashboardKpiTileIsMetric(display: string | number): boolean {
  return typeof display === "number";
}

export const COORDINATOR_DASHBOARD_NO_RESIDENT_POSTED_COPY = "No resident posted";
export const COORDINATOR_DASHBOARD_NO_NAME_POSTED_COPY = "No name posted";

const EM_DASH = "—";
const LEGACY_UNKNOWN = "Unknown";

function isBlankOrEmDashOrLegacyUnknown(value: string | null | undefined): boolean {
  if (value == null) return true;
  const trimmed = String(value).trim();
  return trimmed === "" || trimmed === EM_DASH || trimmed === LEGACY_UNKNOWN;
}

export type CoordinatorDashboardResidentNameFields = {
  first_name: string | null;
  last_name: string | null;
};

function residentNameFromFields(r: CoordinatorDashboardResidentNameFields): string {
  return `${r.first_name?.trim() ?? ""} ${r.last_name?.trim() ?? ""}`.trim();
}

/** Resident label on coordinator dashboard brief rows when the join or name is unset, blank, em dash, or legacy Unknown. */
export function formatCoordinatorDashboardResidentName(
  resident: CoordinatorDashboardResidentNameFields | null | undefined,
): string {
  if (!resident) return COORDINATOR_DASHBOARD_NO_RESIDENT_POSTED_COPY;
  const name = residentNameFromFields(resident);
  if (isBlankOrEmDashOrLegacyUnknown(name)) return COORDINATOR_DASHBOARD_NO_NAME_POSTED_COPY;
  return name;
}
