/**
 * Quiet Operator copy for v2 list primary labels (residents + admissions rows).
 * Missing resident names name real gaps — never silent em dashes or fabricated names.
 */

export const V2_LIST_NO_RESIDENT_POSTED_COPY = "No resident posted";

const EM_DASH = "—";

function isBlankOrEmDash(value: string | null | undefined): boolean {
  if (value == null) return true;
  const trimmed = String(value).trim();
  return trimmed === "" || trimmed === EM_DASH;
}

/** Resident primary label on a v2 list row when unset, blank, or em dash. */
export function formatV2ListResidentPrimary(
  residentName: string | null | undefined,
): string {
  if (isBlankOrEmDash(residentName)) return V2_LIST_NO_RESIDENT_POSTED_COPY;
  return String(residentName).trim();
}
