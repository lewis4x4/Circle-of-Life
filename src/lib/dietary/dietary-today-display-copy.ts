/**
 * Quiet Operator copy for the dietary command deck (`useDietaryToday`).
 * Missing resident joins and blank posted fields name real gaps — never fabricate labels.
 */

export const DIETARY_TODAY_NO_RESIDENT_COPY = "No resident posted";
export const DIETARY_TODAY_NO_NAME_COPY = "No name posted";
export const DIETARY_TODAY_NO_ROOM_COPY = "No room posted";

export type DietaryTodayResidentRef = {
  first_name?: string | null;
  last_name?: string | null;
} | null | undefined;

function trimName(value: string | null | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

function residentNameParts(resident: DietaryTodayResidentRef): {
  first: string;
  last: string;
} | null {
  if (resident == null) return null;
  return {
    first: trimName(resident.first_name),
    last: trimName(resident.last_name),
  };
}

/** Tray tickets and other full-name rows — "Last, First" when posted. */
export function formatDietaryTodayResidentName(resident: DietaryTodayResidentRef): string {
  const parts = residentNameParts(resident);
  if (!parts) return DIETARY_TODAY_NO_RESIDENT_COPY;
  if (!parts.first && !parts.last) return DIETARY_TODAY_NO_NAME_COPY;
  return `${parts.last}, ${parts.first}`;
}

/** Fortification and refusal compact rows — "Last, F." when posted. */
export function formatDietaryTodayCompactName(resident: DietaryTodayResidentRef): string {
  const parts = residentNameParts(resident);
  if (!parts) return DIETARY_TODAY_NO_RESIDENT_COPY;
  if (!parts.first && !parts.last) return DIETARY_TODAY_NO_NAME_COPY;
  if (!parts.first) return parts.last;
  return `${parts.last}, ${parts.first.charAt(0)}.`;
}

const BLANK_ROOM_MARKERS = new Set(["", "-", "—", "–"]);

/** Room label on tray tickets, fortification, and refusal rows. */
export function formatDietaryTodayRoom(roomNumber: string | null | undefined): string {
  const trimmed = typeof roomNumber === "string" ? roomNumber.trim() : "";
  if (BLANK_ROOM_MARKERS.has(trimmed)) return DIETARY_TODAY_NO_ROOM_COPY;
  return trimmed;
}
