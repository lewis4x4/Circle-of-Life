import { currentShiftForTimezone } from "@/lib/caregiver/shift";

/**
 * Quiet Operator copy for caregiver task queue shift bucket.
 * Missing facility timezone names the gap — never a silent dash.
 */

export const CAREGIVER_TASKS_NO_SHIFT_COPY = "No shift posted";

/** Shift bucket label for the task queue metric — never a silent dash when timezone is missing. */
export function formatCaregiverTasksShiftBucket(timeZone: string | null | undefined): string {
  const trimmed = timeZone?.trim();
  if (!trimmed) return CAREGIVER_TASKS_NO_SHIFT_COPY;
  return currentShiftForTimezone(trimmed);
}
