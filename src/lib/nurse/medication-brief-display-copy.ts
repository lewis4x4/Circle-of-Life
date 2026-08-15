/**
 * Quiet Operator copy for nurse medication brief watchlist room labels.
 * The resident assurance payload has no room field — name the gap instead of a silent dash.
 */

export const NURSE_WATCHLIST_NO_ROOM_COPY = "No room posted";

const LEGACY_NO_ROOM_SENTINEL = "—";

/** Dashboard label for watchlist rows: posted rooms vs safety watch (no room on file). */
export function formatNurseWatchlistRoomLabel(room: string): string {
  const trimmed = room.trim();
  if (
    !trimmed ||
    trimmed === LEGACY_NO_ROOM_SENTINEL ||
    trimmed === NURSE_WATCHLIST_NO_ROOM_COPY
  ) {
    return "Safety watch";
  }
  return `Room ${room}`;
}
