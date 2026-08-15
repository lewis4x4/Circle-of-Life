/**
 * Quiet Operator copy for operations task lists and loaders.
 * Missing facility names name real gaps — never fabricate labels or legacy generic copy.
 */

export const OPERATIONS_NO_FACILITY_COPY = "No facility posted";
export const OPERATIONS_NO_MISSED_AT_COPY = "No time posted";

const EM_DASH = "—";
const LEGACY_UNKNOWN = "Unknown";
const LEGACY_UNKNOWN_FACILITY = "Unknown facility";
const LEGACY_UNKNOWN_FACILITY_TITLE = "Unknown Facility";
const LEGACY_UNNAMED = "Unnamed";
const LEGACY_UNNAMED_FACILITY = "Unnamed facility";

function isBlankEmDashOrLegacyFacilityName(value: string): boolean {
  return (
    value === "" ||
    value === EM_DASH ||
    value === LEGACY_UNKNOWN ||
    value === LEGACY_UNKNOWN_FACILITY ||
    value === LEGACY_UNKNOWN_FACILITY_TITLE ||
    value === LEGACY_UNNAMED ||
    value === LEGACY_UNNAMED_FACILITY
  );
}

function isBlankOrEmDash(value: string): boolean {
  const trimmed = value.trim();
  return trimmed === "" || trimmed === EM_DASH;
}

/** Facility name on an operation task when the join is missing, blank, em dash, or legacy generic copy. */
export function formatOperationsFacilityName(name: string | null | undefined): string {
  if (name == null) return OPERATIONS_NO_FACILITY_COPY;
  const trimmed = name.trim();
  if (isBlankEmDashOrLegacyFacilityName(trimmed)) {
    return OPERATIONS_NO_FACILITY_COPY;
  }
  return trimmed;
}

/** Missed-at timestamp on an operation task when the value is missing, blank, em dash, or unparseable. */
export function formatOperationsMissedAt(iso: string | null | undefined): string {
  if (iso == null) return OPERATIONS_NO_MISSED_AT_COPY;
  const trimmed = iso.trim();
  if (isBlankOrEmDash(trimmed)) return OPERATIONS_NO_MISSED_AT_COPY;
  const date = new Date(trimmed);
  if (Number.isNaN(date.getTime())) return OPERATIONS_NO_MISSED_AT_COPY;
  return date.toLocaleString();
}
