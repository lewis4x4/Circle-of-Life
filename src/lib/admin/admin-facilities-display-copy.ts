/**
 * Quiet Operator copy for admin facility option labels (AppShell / AdminShell selectors).
 * Missing facility names name real gaps — never fabricate labels or legacy generic copy.
 */

export const ADMIN_FACILITIES_NO_FACILITY_COPY = "No facility posted";

const EM_DASH = "—";
const LEGACY_UNNAMED_FACILITY = "Unnamed facility";
const LEGACY_UNKNOWN = "Unknown";

function isBlankEmDashOrLegacyFacilityName(value: string): boolean {
  return (
    value === "" ||
    value === EM_DASH ||
    value === LEGACY_UNNAMED_FACILITY ||
    value === LEGACY_UNKNOWN
  );
}

/** Facility name in admin facility option lists when the row name is unset, blank, em dash, or legacy generic copy. */
export function formatAdminFacilityOptionNameDisplay(name: string | null | undefined): string {
  if (name == null) return ADMIN_FACILITIES_NO_FACILITY_COPY;
  const trimmed = name.trim();
  if (isBlankEmDashOrLegacyFacilityName(trimmed)) {
    return ADMIN_FACILITIES_NO_FACILITY_COPY;
  }
  return trimmed;
}
