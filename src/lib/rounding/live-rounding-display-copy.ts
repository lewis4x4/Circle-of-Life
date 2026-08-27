/**
 * Quiet Operator copy for the admin live rounding board (`/admin/rounding/live`).
 * Missing shift types name real gaps — never fabricate shift labels.
 */

export const LIVE_ROUNDING_NO_RESIDENT_COPY = "No resident posted";

export const LIVE_ROUNDING_NO_SHIFT_TYPE_COPY = "No shift posted";

export const LIVE_ROUNDING_NO_DUE_DATE_COPY = "No date posted";

export const LIVE_ROUNDING_NO_TIME_COPY = "No time posted";

const LIVE_ROUNDING_LEGACY_UNKNOWN_DUE = "Unknown";
const LIVE_ROUNDING_LEGACY_RESIDENT = "Resident";
const LIVE_ROUNDING_EM_DASH = "—";
const LIVE_ROUNDING_NEW_YORK_TZ = "America/New_York";

/** Resident name on a live rounding card — names the join gap instead of inventing “Resident”. */
export function formatLiveRoundingResidentDisplay(person?: {
  first_name: string | null;
  last_name: string | null;
  preferred_name: string | null;
} | null): string {
  const first = (person?.preferred_name ?? person?.first_name)?.trim() ?? "";
  const last = person?.last_name?.trim() ?? "";
  const combined = `${first} ${last}`.trim();
  if (!combined || combined === LIVE_ROUNDING_LEGACY_RESIDENT) {
    return LIVE_ROUNDING_NO_RESIDENT_COPY;
  }
  return combined;
}

/** Shift type cell on a live rounding task row — full phrase, no dangling "shift". */
export function formatLiveRoundingShiftType(shiftType: string | null | undefined): string {
  const trimmed = shiftType?.trim();
  if (!trimmed) return LIVE_ROUNDING_NO_SHIFT_TYPE_COPY;
  return `${trimmed} shift`;
}

/** Due-at cell on a live rounding task row — relative time or named gap when unposted. */
export function formatLiveRoundingDueLabel(
  value: string | null | undefined,
  now = Date.now(),
): string {
  const trimmed = value?.trim();
  if (
    !trimmed ||
    trimmed === LIVE_ROUNDING_EM_DASH ||
    trimmed === LIVE_ROUNDING_LEGACY_UNKNOWN_DUE
  ) {
    return LIVE_ROUNDING_NO_DUE_DATE_COPY;
  }

  const dueAt = new Date(trimmed);
  if (Number.isNaN(dueAt.getTime())) return LIVE_ROUNDING_NO_DUE_DATE_COPY;

  const diff = dueAt.getTime() - now;
  const mins = Math.round(Math.abs(diff) / 60000);
  if (mins < 1) return "Now";
  if (diff > 0) return `in ${mins}m`;
  return `${mins}m ago`;
}

/** Clock-time cell on a live rounding task row — hour:minute in Eastern or named gap when unposted. */
export function formatLiveRoundingTimeOfDay(
  value: string | null | undefined,
): string {
  const trimmed = value?.trim();
  if (
    !trimmed ||
    trimmed === LIVE_ROUNDING_EM_DASH ||
    trimmed === LIVE_ROUNDING_LEGACY_UNKNOWN_DUE
  ) {
    return LIVE_ROUNDING_NO_TIME_COPY;
  }

  const date = new Date(trimmed);
  if (Number.isNaN(date.getTime())) return LIVE_ROUNDING_NO_TIME_COPY;

  try {
    return new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      minute: "2-digit",
      timeZone: LIVE_ROUNDING_NEW_YORK_TZ,
    }).format(date);
  } catch {
    return LIVE_ROUNDING_NO_TIME_COPY;
  }
}
