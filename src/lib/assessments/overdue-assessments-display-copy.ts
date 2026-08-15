/**
 * Quiet Operator resident labels for overdue assessment and care-plan review queues.
 * Missing resident rows and blank names name real gaps — never fabricate resident names.
 */

export const OVERDUE_ASSESSMENTS_NO_RESIDENT_POSTED_COPY = "No resident posted";
export const OVERDUE_ASSESSMENTS_NO_NAME_POSTED_COPY = "No name posted";

const EM_DASH = "—";

function isBlankOrEmDash(value: string | null | undefined): boolean {
  if (value == null) return true;
  const trimmed = String(value).trim();
  return trimmed === "" || trimmed === EM_DASH;
}

export type OverdueAssessmentsResidentNameFields = {
  first_name: string | null;
  last_name: string | null;
};

/** Trim/join resident name fields — no fabricated fallback. */
export function overdueAssessmentsResidentNameFromFields(
  resident: OverdueAssessmentsResidentNameFields,
): string {
  return `${resident.first_name?.trim() ?? ""} ${resident.last_name?.trim() ?? ""}`.trim();
}

/** Resident label on an overdue assessment or care-plan review row when the join or name is unset, blank, or em dash. */
export function formatOverdueAssessmentsResidentLabel(
  resident: OverdueAssessmentsResidentNameFields | null | undefined,
): string {
  if (!resident) return OVERDUE_ASSESSMENTS_NO_RESIDENT_POSTED_COPY;
  const name = overdueAssessmentsResidentNameFromFields(resident);
  if (isBlankOrEmDash(name)) return OVERDUE_ASSESSMENTS_NO_NAME_POSTED_COPY;
  return name;
}
