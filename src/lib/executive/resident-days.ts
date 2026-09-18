/**
 * Resident-days actually recorded for the incident-rate window.
 *
 * The rate's denominator is the resident-days served across the trailing
 * window. Until COL-414 there was no daily census history to add up, so the
 * executive run took the census on the day it executed and multiplied it by the
 * window length. A portfolio that admitted through the month is credited with
 * its highest census on every day of it; one that discharged gets the reverse.
 *
 * `census_daily_log` now carries one row per facility per operating day (the
 * midnight census, written by the `daily-census-log` job). This module adds
 * those days up and — just as importantly — reports how many of the window's
 * days it could actually add up. A day that not every facility in scope
 * recorded is not counted as measured: adding a partial day to a full one would
 * quietly shrink the denominator and inflate the rate, which is the bug this
 * work exists to remove.
 */

import { INCIDENT_RATE_WINDOW_DAYS } from "@/lib/executive/snapshot-evidence";
import type { Database } from "@/types/database";
import type { SupabaseClient } from "@supabase/supabase-js";

/** One facility's recorded census for one operating day. */
export type CensusDayRow = {
  facility_id: string;
  log_date: string;
  occupied_beds: number | null;
};

export type ResidentDayWindow = {
  /** First operating day of the window (YYYY-MM-DD, inclusive). */
  startDate: string;
  /** Last operating day of the window (YYYY-MM-DD, inclusive). */
  endDate: string;
  /** Days the window spans. */
  windowDays: number;
  /** Days every facility in scope recorded a census for. */
  measuredDays: number;
  /** Resident-days summed over the measured days only. */
  residentDays: number;
  /** Facilities the window expects a census from each day. */
  facilityCount: number;
};

/**
 * How far back to read. The window itself is 30 days, but it is anchored on the
 * run's date rather than on today, and a run can be a few days old.
 */
export const RESIDENT_DAY_LOOKBACK_DAYS = INCIDENT_RATE_WINDOW_DAYS * 2;

function addDaysIsoDate(isoDate: string, days: number): string {
  const parsed = Date.parse(`${isoDate}T00:00:00.000Z`);
  if (Number.isNaN(parsed)) return isoDate;
  return new Date(parsed + days * 86_400_000).toISOString().slice(0, 10);
}

/** The window's days, oldest first, ending on (and including) `endIsoDate`. */
export function residentDayWindowDates(endIsoDate: string, windowDays: number): string[] {
  const days: string[] = [];
  for (let offset = windowDays - 1; offset >= 0; offset -= 1) {
    days.push(addDaysIsoDate(endIsoDate, -offset));
  }
  return days;
}

function usableCensus(value: number | null): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
  return value;
}

/**
 * Add up the days that were recorded, and count them. A day is measured only
 * when every facility in scope recorded it; anything less is left to the caller
 * to name as unmeasured rather than folded into the total.
 */
export function summarizeResidentDayWindow(input: {
  rows: readonly CensusDayRow[];
  facilityIds: readonly string[];
  endIsoDate: string;
  windowDays?: number;
}): ResidentDayWindow {
  const windowDays = input.windowDays ?? INCIDENT_RATE_WINDOW_DAYS;
  const dates = residentDayWindowDates(input.endIsoDate, windowDays);
  const inWindow = new Set(dates);
  const inScope = new Set(input.facilityIds);

  const byDate = new Map<string, Map<string, number>>();
  for (const row of input.rows) {
    if (!inWindow.has(row.log_date) || !inScope.has(row.facility_id)) continue;
    const occupied = usableCensus(row.occupied_beds);
    if (occupied === null) continue;
    const forDate = byDate.get(row.log_date) ?? new Map<string, number>();
    forDate.set(row.facility_id, occupied);
    byDate.set(row.log_date, forDate);
  }

  let measuredDays = 0;
  let residentDays = 0;
  if (inScope.size > 0) {
    for (const date of dates) {
      const forDate = byDate.get(date);
      if (!forDate || forDate.size < inScope.size) continue;
      measuredDays += 1;
      for (const occupied of forDate.values()) residentDays += occupied;
    }
  }

  return {
    startDate: dates[0] ?? input.endIsoDate,
    endDate: input.endIsoDate,
    windowDays,
    measuredDays,
    residentDays,
    facilityCount: inScope.size,
  };
}

/**
 * Recorded census rows around the window. Reads only what is there: a day the
 * job never wrote comes back missing, and stays missing.
 */
export async function fetchCensusDailyLog(
  supabase: SupabaseClient<Database>,
  organizationId: string,
  options: { endIsoDate: string; lookbackDays?: number } ,
): Promise<CensusDayRow[]> {
  const lookbackDays = options.lookbackDays ?? RESIDENT_DAY_LOOKBACK_DAYS;
  const startIsoDate = addDaysIsoDate(options.endIsoDate, -(lookbackDays - 1));

  const { data, error } = await supabase
    .from("census_daily_log")
    .select("facility_id, log_date, occupied_beds")
    .eq("organization_id", organizationId)
    .gte("log_date", startIsoDate)
    .lte("log_date", options.endIsoDate);

  if (error) throw new Error(error.message);
  return (data ?? []) as CensusDayRow[];
}
