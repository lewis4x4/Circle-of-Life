/**
 * Quiet Operator copy for resident detail overview verifier labels.
 * Missing staff joins name real gaps — never fabricate verifier names.
 */

export const RESIDENT_OVERVIEW_NO_STAFF_COPY = "No staff posted";
export const RESIDENT_OVERVIEW_NO_GENDER_COPY = "No gender posted";
export const RESIDENT_OVERVIEW_NO_DATE_COPY = "No date posted";

function isResidentOverviewDateGap(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return true;
  if (trimmed === "—") return true;
  return trimmed.toLowerCase() === "unknown";
}

function isResidentOverviewGenderGap(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return true;
  if (trimmed === "—") return true;
  const lower = trimmed.toLowerCase();
  return lower === "unknown" || lower === "unnamed";
}

/**
 * Gender label on the resident overview subtitle.
 * Names a missing gender gap — never invent or assume a gender.
 */
export function formatResidentOverviewGenderLabel(value: string | null | undefined): string {
  if (value == null) return RESIDENT_OVERVIEW_NO_GENDER_COPY;
  const trimmed = value.trim();
  if (isResidentOverviewGenderGap(trimmed)) return RESIDENT_OVERVIEW_NO_GENDER_COPY;
  const lower = trimmed.toLowerCase();
  if (lower === "male") return "Male";
  if (lower === "female") return "Female";
  return trimmed.replace(/_/g, " ");
}

/**
 * Admission date label on the resident overview subtitle.
 * Names a missing admission date gap — never invent or assume a date.
 */
export function formatResidentOverviewAdmissionLabel(value: string | null | undefined): string {
  if (value == null) return RESIDENT_OVERVIEW_NO_DATE_COPY;
  const trimmed = value.trim();
  if (isResidentOverviewDateGap(trimmed)) return RESIDENT_OVERVIEW_NO_DATE_COPY;
  const parsed = new Date(`${trimmed}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return RESIDENT_OVERVIEW_NO_DATE_COPY;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(parsed);
}

/**
 * Verifier staff label on the resident overview when a verifier id is posted.
 * Returns null when no verifier id is recorded (do not invent a verifier).
 */
export function formatResidentOverviewVerifiedByStaffLabel(
  verifierId: string | null | undefined,
  joinedName: string | null | undefined,
): string | null {
  if (!verifierId) return null;
  if (!joinedName) return RESIDENT_OVERVIEW_NO_STAFF_COPY;
  const trimmed = joinedName.trim();
  if (!trimmed) return RESIDENT_OVERVIEW_NO_STAFF_COPY;
  return trimmed;
}
