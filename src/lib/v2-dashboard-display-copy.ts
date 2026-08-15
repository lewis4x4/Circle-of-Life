/**
 * Quiet Operator copy for v2 dashboard facility names and scope labels.
 * Missing, blank, em-dash, or legacy generic copy names real gaps — never fabricate labels.
 */

export const V2_DASHBOARD_NO_FACILITY_COPY = "No facility posted";

export const V2_DASHBOARD_NO_VALUE_COPY = "No value posted";

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

/** Facility name/label on v2 dashboard table rows and scope filters when the row name is unset or legacy generic copy. */
export function formatV2DashboardFacilityDisplay(name: string | null | undefined): string {
  if (name == null) return V2_DASHBOARD_NO_FACILITY_COPY;
  const trimmed = name.trim();
  if (isBlankEmDashOrLegacyFacilityName(trimmed)) {
    return V2_DASHBOARD_NO_FACILITY_COPY;
  }
  return trimmed;
}

/** Numeric table metric on v2 dashboard rows when the value is missing or non-finite. */
export function formatV2DashboardMetric(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return V2_DASHBOARD_NO_VALUE_COPY;
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}
