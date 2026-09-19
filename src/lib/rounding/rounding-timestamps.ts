/**
 * Timestamps for the Smart Rounding surfaces, in the building's clock.
 *
 * Extracted from `escalations-display-copy.ts` when the Escalations tab folded
 * into the Live board. Every surface in the module reads the same way.
 */

const ROUNDING_OPERATOR_TZ = "America/New_York";

const ROUNDING_DATE_TIME_FORMAT: Intl.DateTimeFormatOptions = {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone: ROUNDING_OPERATOR_TZ,
};

/** Date and time in the building's clock, or the named gap when unposted. */
export function formatEscalationTimestamp(value: string | null | undefined): string {
  const trimmed = value?.trim();
  if (!trimmed) return "No time posted";

  const date = new Date(trimmed);
  if (Number.isNaN(date.getTime())) return "No time posted";

  try {
    return new Intl.DateTimeFormat("en-US", ROUNDING_DATE_TIME_FORMAT).format(date);
  } catch {
    return "No time posted";
  }
}
