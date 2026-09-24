/**
 * The shift in force for the floor screens, from the facility's configured
 * shift definitions (the same model the caregiver header reads, COL-659).
 */

import type { CaregiverFacilityContext } from "@/lib/caregiver/facility-context";
import { facilityDatetimeLocalToUtcIso } from "@/lib/facility-wall-clock";
import { facilityDateOf, shiftSpanAt } from "@/lib/rounding/observation-cadence";

/** A facility with no definitions covering now looks back this far instead of guessing a shift. */
export const FLOOR_FALLBACK_WINDOW_HOURS = 12;

export type FloorShiftWindow = {
  startIso: string;
  /** When the shift hands off, or null when the facility has no shift definitions. */
  endIso: string | null;
  label: string | null;
};

export function floorShiftWindow(facility: Pick<CaregiverFacilityContext, "timeZone" | "shifts">, now: Date = new Date()): FloorShiftWindow {
  const span = facility.shifts && facility.shifts.length > 0 ? shiftSpanAt(facility.shifts, now, facility.timeZone) : null;
  if (span) return { startIso: span.startsAt.toISOString(), endIso: span.endsAt.toISOString(), label: span.label };
  return {
    startIso: new Date(now.getTime() - FLOOR_FALLBACK_WINDOW_HOURS * 60 * 60_000).toISOString(),
    endIso: null,
    label: null,
  };
}

/** Midnight at the facility, for "today's" reads. */
export function facilityDayStartIso(timeZone: string, now: Date = new Date()): string {
  return facilityDatetimeLocalToUtcIso(`${facilityDateOf(now, timeZone)}T00:00`, timeZone);
}

/** "Sep 26", in the facility's zone. */
export function formatShortDate(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone, month: "short", day: "numeric" }).format(new Date(iso));
}
