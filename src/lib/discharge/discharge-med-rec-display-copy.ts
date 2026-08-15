/**
 * Quiet Operator copy for the discharge med reconciliation hub.
 * Missing counts and resident joins name real gaps — never fabricate pipeline metrics or person names.
 */

export type DischargeMedRecHubKpiKey =
  | "planning_gaps"
  | "pharmacist_review"
  | "ready_to_complete";

const LOADING_COPY: Record<DischargeMedRecHubKpiKey, string> = {
  planning_gaps: "Loading planning gaps count…",
  pharmacist_review: "Loading external pharmacist review count…",
  ready_to_complete: "Loading ready to complete count…",
};

const NO_COUNT_POSTED_COPY: Record<DischargeMedRecHubKpiKey, string> = {
  planning_gaps: "No planning gaps count posted",
  pharmacist_review: "No external pharmacist review count posted",
  ready_to_complete: "No ready to complete count posted",
};

/** KPI tile body — real zeros stay numeric; loading and missing counts get explicit copy. */
export function formatDischargeMedRecHubKpiValue(
  key: DischargeMedRecHubKpiKey,
  value: number | null | undefined,
  isLoading: boolean,
): string | number {
  if (isLoading) return LOADING_COPY[key];
  if (value == null) return NO_COUNT_POSTED_COPY[key];
  return value;
}

/** Whether a KPI tile is showing a loaded metric (including real zeros). */
export function dischargeMedRecHubKpiTileIsMetric(display: string | number): boolean {
  return typeof display === "number";
}

export const DISCHARGE_MED_REC_NO_RESIDENT_POSTED_COPY = "No resident posted";
export const DISCHARGE_MED_REC_NO_NAME_POSTED_COPY = "No name posted";

export type DischargeMedRecResidentNameJoin = {
  first_name: string | null;
  last_name: string | null;
} | null | undefined;

const DISCHARGE_MED_REC_PLACEHOLDER_RESIDENT_NAMES = new Set([
  "—",
  "unknown",
  "unknown resident",
  "unnamed",
  "unnamed resident",
]);

/** Resident name on the med rec hub table — never invents a person or legacy Unknown labels. */
export function formatDischargeMedRecResidentName(
  resident: DischargeMedRecResidentNameJoin,
): string {
  if (!resident) return DISCHARGE_MED_REC_NO_RESIDENT_POSTED_COPY;

  const first = (resident.first_name ?? "").trim();
  const last = (resident.last_name ?? "").trim();
  const combined = [first, last].filter((part) => part.length > 0).join(" ");

  if (!combined) return DISCHARGE_MED_REC_NO_NAME_POSTED_COPY;
  if (DISCHARGE_MED_REC_PLACEHOLDER_RESIDENT_NAMES.has(combined.toLowerCase())) {
    return DISCHARGE_MED_REC_NO_NAME_POSTED_COPY;
  }

  return combined;
}
