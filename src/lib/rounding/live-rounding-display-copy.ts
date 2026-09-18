/**
 * Timestamp copy for the Smart Rounding Live board.
 *
 * `formatLiveRoundingShiftType` is gone with the board's `shift_assignments`
 * embed. It turned a `shift_type` value into "night shift" by appending a word,
 * which meant the module rendered whatever the roster enum held, including the
 * `evening` value the enum still carries for other modules. Spec decision D3
 * puts that out of this module: shift labels now come from
 * `facility_shift_definitions` rows through `liveBoardShiftLabel`, and a window
 * whose shift the building does not run says so.
 *
 * `formatLiveRoundingResidentDisplay` is gone with the same embed. Resident
 * names come from the roster read and are named by `indexLiveBoardRoster`,
 * because the task-side embed that used to carry them also asked for a
 * `residents.room_number` column that does not exist and failed the whole
 * query.
 */

export const LIVE_ROUNDING_NO_DUE_DATE_COPY = "No date posted";

export const LIVE_ROUNDING_NO_TIME_COPY = "No time posted";

const LIVE_ROUNDING_LEGACY_UNKNOWN_DUE = "Unknown";
const LIVE_ROUNDING_EM_DASH = "—";
const LIVE_ROUNDING_NEW_YORK_TZ = "America/New_York";

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

/** Clock-time cell — hour:minute in Eastern, or the named gap when unposted. */
export function formatLiveRoundingTimeOfDay(value: string | null | undefined): string {
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
