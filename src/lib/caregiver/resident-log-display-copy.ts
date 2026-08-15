/**
 * Quiet Operator copy for caregiver resident shift-log daily notes.
 * Missing, blank, or silent em-dash notes name the gap — never a bare "—".
 */

export const CAREGIVER_RESIDENT_LOG_NO_NOTES_COPY = "No notes posted";

const SILENT_PLACEHOLDER_DASH = "—";

/** Recent daily-note body text for caregiver shift-log history lists. */
export function formatCaregiverResidentLogGeneralNotes(
  generalNotes: string | null | undefined,
): string {
  const trimmed = generalNotes?.trim() ?? "";
  if (trimmed.length === 0 || trimmed === SILENT_PLACEHOLDER_DASH) {
    return CAREGIVER_RESIDENT_LOG_NO_NOTES_COPY;
  }
  return trimmed;
}
