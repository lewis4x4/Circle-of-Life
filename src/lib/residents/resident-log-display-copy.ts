/**
 * Quiet Operator copy for resident daily-note history in admin log modals.
 * Missing or blank notes name the gap — never a silent em dash.
 */

export const RESIDENT_DAILY_NOTES_EMPTY_COPY = "No notes posted";

/** Recent daily-note body text for operator-facing history lists. */
export function formatResidentDailyNotesDisplay(
  generalNotes: string | null | undefined,
): string {
  const trimmed = generalNotes?.trim() ?? "";
  if (trimmed.length === 0) return RESIDENT_DAILY_NOTES_EMPTY_COPY;
  return trimmed;
}
