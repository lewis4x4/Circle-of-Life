/**
 * Quiet Operator copy for the new verbal order page (`/admin/medications/verbal-orders/new`).
 * Missing facility names name real gaps — never fabricate labels or legacy generic copy.
 */

export const VERBAL_ORDERS_NEW_NO_FACILITY_COPY = "No facility posted";

const EM_DASH = "—";
const LEGACY_UNKNOWN = "Unknown";
const LEGACY_UNKNOWN_FACILITY = "Unknown facility";
const LEGACY_UNNAMED = "Unnamed";
const LEGACY_UNNAMED_FACILITY = "Unnamed facility";

function isBlankEmDashOrLegacyFacilityName(value: string): boolean {
  return (
    value === "" ||
    value === EM_DASH ||
    value === LEGACY_UNKNOWN ||
    value === LEGACY_UNKNOWN_FACILITY ||
    value === LEGACY_UNNAMED ||
    value === LEGACY_UNNAMED_FACILITY
  );
}

/** Facility name on the new verbal order page when the selection is missing a posted name. */
export function formatVerbalOrderFacilityName(name: string | null | undefined): string {
  if (name == null) return VERBAL_ORDERS_NEW_NO_FACILITY_COPY;
  const trimmed = name.trim();
  if (isBlankEmDashOrLegacyFacilityName(trimmed)) {
    return VERBAL_ORDERS_NEW_NO_FACILITY_COPY;
  }
  return trimmed;
}
