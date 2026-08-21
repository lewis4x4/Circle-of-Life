import {
  facilityDateIsoDaysFromToday,
  todayFacilityDateIso,
} from "@/lib/facility-wall-clock";

export type RoundingReportDateRangePreset =
  | "last_7"
  | "last_30"
  | "this_month"
  | "last_month"
  | "quarter_to_date"
  | "custom";

/** Page-local alias for preset union. */
export type DateRangePreset = RoundingReportDateRangePreset;

export type RoundingReportDateRange = {
  from: string;
  to: string;
};

function formatIsoDate(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function parseIsoDateParts(iso: string): { year: number; month: number; day: number } {
  const [year, month, day] = iso.split("-").map(Number);
  return { year, month, day };
}

/** `month` is 1-indexed (January = 1). */
function lastDayOfMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

function thisMonthRange(todayIso: string): RoundingReportDateRange {
  const { year, month } = parseIsoDateParts(todayIso);
  return { from: formatIsoDate(year, month, 1), to: todayIso };
}

function lastMonthRange(todayIso: string): RoundingReportDateRange {
  const { year, month } = parseIsoDateParts(todayIso);
  const prevMonth = month === 1 ? 12 : month - 1;
  const prevYear = month === 1 ? year - 1 : year;
  const lastDay = lastDayOfMonth(prevYear, prevMonth);
  return {
    from: formatIsoDate(prevYear, prevMonth, 1),
    to: formatIsoDate(prevYear, prevMonth, lastDay),
  };
}

function quarterToDateRange(todayIso: string): RoundingReportDateRange {
  const { year, month } = parseIsoDateParts(todayIso);
  const quarterStartMonth = Math.floor((month - 1) / 3) * 3 + 1;
  return { from: formatIsoDate(year, quarterStartMonth, 1), to: todayIso };
}

/** Default report window: inclusive last 7 Eastern calendar days. */
export function defaultRoundingReportLast7Days(
  now: Date = new Date(),
): RoundingReportDateRange {
  return {
    from: facilityDateIsoDaysFromToday(-6, now),
    to: todayFacilityDateIso(now),
  };
}

/** Facility-local (America/New_York) preset ranges for rounding completion reports. */
export function roundingReportRangeForPreset(
  preset: RoundingReportDateRangePreset,
  now: Date = new Date(),
): RoundingReportDateRange {
  const todayIso = todayFacilityDateIso(now);
  if (preset === "last_30") {
    return {
      from: facilityDateIsoDaysFromToday(-29, now),
      to: todayIso,
    };
  }
  if (preset === "this_month") {
    return thisMonthRange(todayIso);
  }
  if (preset === "last_month") {
    return lastMonthRange(todayIso);
  }
  if (preset === "quarter_to_date") {
    return quarterToDateRange(todayIso);
  }
  return defaultRoundingReportLast7Days(now);
}
