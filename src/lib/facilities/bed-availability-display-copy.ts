/**
 * Quiet Operator copy for facility bed availability room labels.
 * Missing or blank room numbers name the gap — never a silent dash or invented room number.
 */

const SILENT_PLACEHOLDER_DASH = "—";

export const BED_AVAILABILITY_NO_ROOM_COPY = "No room posted";

/** Posted room number for a bed row — trim only; never invents a room number. */
export function formatBedAvailabilityRoomNumber(
  roomNumber: string | null | undefined,
): string {
  const trimmed = roomNumber?.trim();
  if (!trimmed || trimmed === SILENT_PLACEHOLDER_DASH) {
    return BED_AVAILABILITY_NO_ROOM_COPY;
  }
  return trimmed;
}
