/**
 * Quiet Operator copy for v2 form resident select options.
 * Missing or legacy generic names name real gaps — never fabricate labels.
 */

export const V2_FORM_OPTIONS_NO_RESIDENT_POSTED_COPY = "No resident posted";

const EM_DASH = "—";
const LEGACY_UNNAMED_RESIDENT = "Unnamed resident";
const LEGACY_UNKNOWN = "Unknown";

function isBlankEmDashOrLegacyResidentName(value: string): boolean {
  const trimmed = value.trim();
  return (
    trimmed === "" ||
    trimmed === EM_DASH ||
    trimmed === LEGACY_UNNAMED_RESIDENT ||
    trimmed === LEGACY_UNKNOWN
  );
}

/** Resident label on v2 form selects when unset, blank, em dash, or legacy generic copy. */
export function formatV2FormResidentOptionLabel(
  residentName: string | null | undefined,
): string {
  if (residentName == null) return V2_FORM_OPTIONS_NO_RESIDENT_POSTED_COPY;
  const trimmed = String(residentName).trim();
  if (isBlankEmDashOrLegacyResidentName(trimmed)) return V2_FORM_OPTIONS_NO_RESIDENT_POSTED_COPY;
  return trimmed;
}
