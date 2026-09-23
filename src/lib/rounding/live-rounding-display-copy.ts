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

import { formatDisplayTime, formatRelativeTime } from "@/lib/format/datetime";

export const LIVE_ROUNDING_NO_DUE_DATE_COPY = "No date posted";

export const LIVE_ROUNDING_NO_TIME_COPY = "No time posted";

const LIVE_ROUNDING_LEGACY_UNKNOWN_DUE = "Unknown";
const LIVE_ROUNDING_EM_DASH = "—";

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

  // Hours and days past the first hour: a missed check read "2462m ago" (COL-659).
  return formatRelativeTime(trimmed, now, { fallback: LIVE_ROUNDING_NO_DUE_DATE_COPY });
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

  return formatDisplayTime(trimmed, { fallback: LIVE_ROUNDING_NO_TIME_COPY });
}
