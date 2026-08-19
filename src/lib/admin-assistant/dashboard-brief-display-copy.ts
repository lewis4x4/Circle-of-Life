/**
 * Quiet Operator copy for the admin assistant dashboard brief tiles.
 * Loading and missing states name real gaps — never fabricate census or ops metrics.
 */

export type AdminAssistantDashboardKpiKey =
  | "census"
  | "pending_docs"
  | "staff_bulletin_notes"
  | "transportation_today";

const LOADING_COPY: Record<AdminAssistantDashboardKpiKey, string> = {
  census: "Loading census count…",
  pending_docs: "Loading pending docs…",
  staff_bulletin_notes: "Loading bulletin notes…",
  transportation_today: "Loading transport count…",
};

const NO_COUNT_POSTED_COPY: Record<AdminAssistantDashboardKpiKey, string> = {
  census: "No census count posted",
  pending_docs: "No pending docs count posted",
  staff_bulletin_notes: "No bulletin notes count posted",
  transportation_today: "No transport count posted",
};

export const ADMIN_ASSISTANT_DASHBOARD_LOADING_HEADLINE = "Loading front desk dashboard…";

export const ADMIN_ASSISTANT_DASHBOARD_RECENT_NOTES_LOADING_COPY =
  "Loading recent bulletin notes…";

/** KPI tile body — real zeros stay numeric; loading and missing counts get explicit copy. */
export function formatAdminAssistantDashboardKpiValue(
  key: AdminAssistantDashboardKpiKey,
  value: number | null | undefined,
  isLoading: boolean,
): string | number {
  if (isLoading) return LOADING_COPY[key];
  if (value == null) return NO_COUNT_POSTED_COPY[key];
  return value;
}

/** Whether a KPI tile is showing a loaded metric (including real zeros). */
export function adminAssistantDashboardKpiTileIsMetric(display: string | number): boolean {
  return typeof display === "number";
}
