/**
 * Quiet Operator copy for caregiver resident quick profile metric pills.
 * Names real gaps — never fabricates acuity, mood, or other clinical values.
 */

import { CAREGIVER_FACILITY_RESIDENT_NO_ROOM_COPY } from "@/lib/caregiver/facility-residents-display-copy";

const SILENT_PLACEHOLDER_DASH = "—";

export const CAREGIVER_RESIDENT_NO_ACUITY_COPY = "No acuity posted";
export const CAREGIVER_RESIDENT_NO_MOOD_COPY = "No mood posted";
export const CAREGIVER_RESIDENT_NO_ROOM_COPY = CAREGIVER_FACILITY_RESIDENT_NO_ROOM_COPY;

/** Acuity pill value — posted levels stay as posted; missing data names the gap. */
export function formatCaregiverResidentAcuity(
  value: string | number | null | undefined,
): string {
  if (typeof value === "number") return String(value);
  const trimmed = value?.trim();
  if (!trimmed || trimmed === SILENT_PLACEHOLDER_DASH) {
    return CAREGIVER_RESIDENT_NO_ACUITY_COPY;
  }
  return trimmed;
}

/** Mood pill value — posted moods stay as posted; missing data names the gap. */
export function formatCaregiverResidentMood(value: string | null | undefined): string {
  const trimmed = value?.trim();
  if (!trimmed || trimmed === SILENT_PLACEHOLDER_DASH) {
    return CAREGIVER_RESIDENT_NO_MOOD_COPY;
  }
  return trimmed;
}

/** Room pill value — posted rooms stay Room {number}; missing data names the gap. */
export function formatCaregiverResidentRoomLabel(
  roomNumber: string | null | undefined,
): string {
  const trimmed = roomNumber?.trim();
  if (!trimmed) {
    return CAREGIVER_RESIDENT_NO_ROOM_COPY;
  }
  return `Room ${trimmed}`;
}
