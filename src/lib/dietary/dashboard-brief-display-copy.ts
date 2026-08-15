/**
 * Quiet Operator copy for the dietary dashboard brief recent diet-change rows.
 * Missing resident joins and blank names name real gaps — never fabricate labels.
 */

export const DIETARY_DASHBOARD_BRIEF_NO_RESIDENT_COPY = "No resident posted";
export const DIETARY_DASHBOARD_BRIEF_NO_NAME_COPY = "No name posted";

const EM_DASH = "—";
const LEGACY_UNKNOWN_RESIDENT = "Unknown";

function isBlankEmDashOrLegacyUnknown(value: string): boolean {
  const trimmed = value.trim();
  return trimmed === "" || trimmed === EM_DASH || trimmed === LEGACY_UNKNOWN_RESIDENT;
}

export type DietaryDashboardBriefResidentRef = {
  first_name: string | null;
  last_name: string | null;
};

/** Resident label on recent diet-change rows when the join or name is unset, blank, em dash, or legacy Unknown. */
export function formatDietaryDashboardBriefResidentName(
  resident: DietaryDashboardBriefResidentRef | null | undefined,
): string {
  if (!resident) return DIETARY_DASHBOARD_BRIEF_NO_RESIDENT_COPY;
  const name = `${resident.first_name?.trim() ?? ""} ${resident.last_name?.trim() ?? ""}`.trim();
  if (isBlankEmDashOrLegacyUnknown(name)) return DIETARY_DASHBOARD_BRIEF_NO_NAME_COPY;
  return name;
}
