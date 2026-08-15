/**
 * Quiet Operator copy for admin activity session rows (`/admin/activities`).
 * Names missing start/end times — never invents posted clock values.
 */

export const ACTIVITIES_NO_START_TIME_COPY = "No start time posted";
export const ACTIVITIES_NO_END_TIME_COPY = "No end time posted";

/** Session start time when the field is null or blank. */
export function formatActivitySessionStartTime(startTime: string | null | undefined): string {
  if (!startTime || !startTime.trim()) return ACTIVITIES_NO_START_TIME_COPY;
  return startTime;
}

/** Session end time when the field is null or blank. */
export function formatActivitySessionEndTime(endTime: string | null | undefined): string {
  if (!endTime || !endTime.trim()) return ACTIVITIES_NO_END_TIME_COPY;
  return endTime;
}

/** Posted start → end range for a session row subtitle. */
export function formatActivitySessionTimeRange(
  startTime: string | null | undefined,
  endTime: string | null | undefined,
): string {
  return `${formatActivitySessionStartTime(startTime)} → ${formatActivitySessionEndTime(endTime)}`;
}
