/**
 * Quiet Operator copy for coordinator dashboard brief resident labels.
 * Missing resident rows and blank names name real gaps — never fabricate labels.
 */

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
