/**
 * Quiet Operator copy for caregiver facility resident room labels.
 * Missing or blank room data names the gap — never a silent dash or invented room number.
 */

const SILENT_PLACEHOLDER_DASH = "—";

export const CAREGIVER_FACILITY_RESIDENT_NO_ROOM_COPY = "No room posted";

/**
 * Room label for census / floor lists.
 * One arg: normalize an existing label. Two args: build from room number + optional bed label.
 */
export function formatCaregiverFacilityResidentRoomLabel(
  roomNumberOrLabel: string | null | undefined,
  bedLabel?: string | null,
): string {
  const trimmedRoom = roomNumberOrLabel?.trim();
  if (!trimmedRoom || trimmedRoom === SILENT_PLACEHOLDER_DASH) {
    return CAREGIVER_FACILITY_RESIDENT_NO_ROOM_COPY;
  }
  if (bedLabel === undefined) {
    return trimmedRoom;
  }
  const trimmedBed = bedLabel?.trim();
  return trimmedBed ? `${trimmedRoom}-${trimmedBed}` : trimmedRoom;
}
