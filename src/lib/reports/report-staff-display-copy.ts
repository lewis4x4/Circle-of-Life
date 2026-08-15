/**
 * Quiet Operator copy for report executor staff_member rows (coverage / overtime).
 * Missing staff joins and blank names name real gaps — never fabricate labels.
 */

export const REPORT_STAFF_NO_STAFF_COPY = "No staff posted";
export const REPORT_STAFF_NO_NAME_COPY = "No name posted";

const EM_DASH = "—";
const LEGACY_UNKNOWN = "Unknown";

function isBlankEmDashOrLegacyUnknown(value: string): boolean {
  const trimmed = value.trim();
  return trimmed === "" || trimmed === EM_DASH || trimmed === LEGACY_UNKNOWN;
}

export type ReportStaffNameFields = {
  first_name?: string | null;
  last_name?: string | null;
};

/** Staff label from first/last fields when building a name map or direct row display. */
export function formatReportStaffMemberFromFields(
  staff: ReportStaffNameFields | null | undefined,
): string {
  if (!staff) return REPORT_STAFF_NO_STAFF_COPY;
  const name = `${staff.first_name?.trim() ?? ""} ${staff.last_name?.trim() ?? ""}`.trim();
  if (isBlankEmDashOrLegacyUnknown(name)) return REPORT_STAFF_NO_NAME_COPY;
  return name;
}

/** Staff label on a report row when resolving from a pre-built id → name map. */
export function formatReportStaffMemberFromMap(
  staffId: string | null | undefined,
  nameById: Map<string, string>,
): string {
  if (!staffId) return REPORT_STAFF_NO_STAFF_COPY;
  if (!nameById.has(staffId)) return REPORT_STAFF_NO_STAFF_COPY;
  const name = nameById.get(staffId);
  if (name == null || isBlankEmDashOrLegacyUnknown(name)) return REPORT_STAFF_NO_NAME_COPY;
  return name.trim();
}
