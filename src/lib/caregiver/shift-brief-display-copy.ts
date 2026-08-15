/**
 * Quiet Operator copy for caregiver shift-brief room labels.
 * Missing or blank room data names the gap — never a silent dash or invented room number.
 */

export const CAREGIVER_SHIFT_BRIEF_NO_ROOM_COPY = "No room posted";

const SILENT_PLACEHOLDER_DASH = "—";

/** Build a shift-brief room label from bed/room data — never a silent dash. */
export function formatCaregiverShiftBriefRoomLabel(input: {
  roomNumber?: string | null;
  bedLabel?: string | null;
}): string {
  const roomNumber = input.roomNumber?.trim();
  if (!roomNumber) return CAREGIVER_SHIFT_BRIEF_NO_ROOM_COPY;
  const bedLabel = input.bedLabel?.trim();
  return bedLabel ? `${roomNumber}-${bedLabel}` : roomNumber;
}

/**
 * Normalize a resident room label for shift-brief eMAR slots.
 * Bridges legacy "—" labels and map misses.
 */
export function caregiverShiftBriefDisplayRoomLabel(roomLabel?: string | null): string {
  const trimmed = roomLabel?.trim();
  if (!trimmed || trimmed === SILENT_PLACEHOLDER_DASH) return CAREGIVER_SHIFT_BRIEF_NO_ROOM_COPY;
  return trimmed;
}
