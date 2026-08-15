/**
 * Quiet Operator copy for the observation plans list (`/admin/rounding/plans`).
 * Missing dates and timestamps name the gap — never a silent em dash.
 */

export const ROUNDING_PLAN_NO_DATE_COPY = "No date posted";
export const ROUNDING_PLAN_NO_TIME_COPY = "No time posted";

const DATE_FORMAT: Intl.DateTimeFormatOptions = {
  month: "short",
  day: "numeric",
  year: "numeric",
};

const DATE_TIME_FORMAT: Intl.DateTimeFormatOptions = {
  ...DATE_FORMAT,
  hour: "numeric",
  minute: "2-digit",
};

/** Effective-window date column — short month, numeric day/year. */
export function formatRoundingPlanDateDisplay(value?: string | null): string {
  if (!value) return ROUNDING_PLAN_NO_DATE_COPY;
  return new Intl.DateTimeFormat("en-US", DATE_FORMAT).format(new Date(value));
}

/** Last-updated datetime column — date plus hour and minute. */
export function formatRoundingPlanDateTimeDisplay(value?: string | null): string {
  if (!value) return ROUNDING_PLAN_NO_TIME_COPY;
  return new Intl.DateTimeFormat("en-US", DATE_TIME_FORMAT).format(new Date(value));
}
