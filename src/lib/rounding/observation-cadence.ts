import { addMinutes } from "date-fns";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";

import { addFacilityCalendarDays, FACILITY_OPERATOR_TZ } from "@/lib/facility-wall-clock";

/**
 * Facility observation cadence, read from configuration.
 *
 * Every window time, grace value and shift boundary in this module is a row in
 * `facility_cadence_windows` and `facility_shift_definitions`, seeded by
 * migration 412 and editable per facility without a deploy. Nothing in this
 * file may hold one as a literal: every function here takes the rows and the
 * facility timezone and does the arithmetic against them.
 *
 * This mirrors `public.facility_observation_windows_for_date` and
 * `public.facility_shift_window_at` so a browser surface can render the cadence
 * in force without a round trip, and so the rules are unit testable. The
 * database remains the authority for what the generator writes.
 */

/** A row from `facility_shift_definitions`. */
export type ObservationShiftDefinition = {
  shiftKey: string;
  label: string;
  /** Facility-local `HH:MM` or `HH:MM:SS`. */
  startsAtLocal: string;
  /** Facility-local. At or before `startsAtLocal` means the shift crosses midnight. */
  endsAtLocal: string;
  sortOrder: number;
};

/** A row from `facility_cadence_windows`. */
export type ObservationCadenceWindow = {
  cadenceVersionId: string;
  windowKey: string;
  label: string;
  /** Facility-local `HH:MM` or `HH:MM:SS`. */
  dueAtLocal: string;
  graceBeforeMinutes: number;
  graceAfterMinutes: number;
  shiftKey: string;
  sortOrder: number;
  enabled: boolean;
};

/** A cadence window placed on a calendar date, in absolute time. */
export type ResolvedObservationWindow = {
  cadenceVersionId: string;
  windowKey: string;
  label: string;
  shiftKey: string;
  /** Facility-local calendar date the window belongs to, `YYYY-MM-DD`. */
  serviceDate: string;
  dueAt: Date;
  opensAt: Date;
  closesAt: Date;
};

/** A shift placed on a calendar date, in absolute time. */
export type ResolvedShiftSpan = {
  shiftKey: string;
  label: string;
  /** Facility-local calendar date the shift started on. Matches `shift_assignments.shift_date`. */
  serviceDate: string;
  startsAt: Date;
  endsAt: Date;
};

const LOCAL_TIME_RE = /^(\d{2}):(\d{2})(?::(\d{2}))?$/;

/** Normalize `HH:MM` and `HH:MM:SS` to `HH:MM:SS` so string compare matches clock order. */
function normalizeLocalTime(value: string): string {
  const match = LOCAL_TIME_RE.exec(value.trim());
  if (!match) {
    throw new Error(`Local time must match HH:MM or HH:MM:SS, received "${value}"`);
  }
  return `${match[1]}:${match[2]}:${match[3] ?? "00"}`;
}

function facilityLocalInstant(dateIso: string, localTime: string, timeZone: string): Date {
  return fromZonedTime(`${dateIso}T${normalizeLocalTime(localTime)}`, timeZone);
}

/** Facility-local calendar date of an instant, `YYYY-MM-DD`. */
export function facilityDateOf(at: Date, timeZone: string = FACILITY_OPERATOR_TZ): string {
  return formatInTimeZone(at, timeZone, "yyyy-MM-dd");
}

/** Place one configured window on one service date. */
export function resolveObservationWindow(
  window: ObservationCadenceWindow,
  serviceDate: string,
  timeZone: string = FACILITY_OPERATOR_TZ,
): ResolvedObservationWindow {
  const dueAt = facilityLocalInstant(serviceDate, window.dueAtLocal, timeZone);
  return {
    cadenceVersionId: window.cadenceVersionId,
    windowKey: window.windowKey,
    label: window.label,
    shiftKey: window.shiftKey,
    serviceDate,
    dueAt,
    opensAt: addMinutes(dueAt, -window.graceBeforeMinutes),
    closesAt: addMinutes(dueAt, window.graceAfterMinutes),
  };
}

/** Every enabled window for one service date, in configured order. */
export function resolveObservationWindowsForDate(
  windows: readonly ObservationCadenceWindow[],
  serviceDate: string,
  timeZone: string = FACILITY_OPERATOR_TZ,
): ResolvedObservationWindow[] {
  return windows
    .filter((window) => window.enabled)
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((window) => resolveObservationWindow(window, serviceDate, timeZone));
}

/**
 * Whether an observation recorded at `observedAt` falls inside the window.
 *
 * A window whose grace before is zero does not accept an observation recorded
 * even a minute early. That is the whole point of a shift change check: the
 * incoming shift has to be the one that lays eyes on the resident, so the
 * outgoing shift cannot clear it on the way out.
 */
export function observationSatisfiesWindow(
  observedAt: Date,
  window: ResolvedObservationWindow,
): boolean {
  return observedAt >= window.opensAt && observedAt <= window.closesAt;
}

/** The window an observation satisfies, or null when it falls in no window. */
export function findWindowSatisfiedByObservation(
  observedAt: Date,
  windows: readonly ResolvedObservationWindow[],
): ResolvedObservationWindow | null {
  return windows.find((window) => observationSatisfiesWindow(observedAt, window)) ?? null;
}

/** Place one configured shift on one service date. */
export function resolveShiftSpan(
  shift: ObservationShiftDefinition,
  serviceDate: string,
  timeZone: string = FACILITY_OPERATOR_TZ,
): ResolvedShiftSpan {
  const startsAtLocal = normalizeLocalTime(shift.startsAtLocal);
  const endsAtLocal = normalizeLocalTime(shift.endsAtLocal);
  const endsOnDate =
    endsAtLocal > startsAtLocal ? serviceDate : addFacilityCalendarDays(serviceDate, 1, timeZone);

  return {
    shiftKey: shift.shiftKey,
    label: shift.label,
    serviceDate,
    startsAt: facilityLocalInstant(serviceDate, startsAtLocal, timeZone),
    endsAt: facilityLocalInstant(endsOnDate, endsAtLocal, timeZone),
  };
}

/** The shift in force at an instant, or null when the shifts do not cover it. */
export function shiftSpanAt(
  shifts: readonly ObservationShiftDefinition[],
  at: Date,
  timeZone: string = FACILITY_OPERATOR_TZ,
): ResolvedShiftSpan | null {
  const today = facilityDateOf(at, timeZone);
  const candidateDates = [addFacilityCalendarDays(today, -1, timeZone), today];

  const containing = candidateDates
    .flatMap((serviceDate) => shifts.map((shift) => resolveShiftSpan(shift, serviceDate, timeZone)))
    .filter((span) => at >= span.startsAt && at < span.endsAt)
    .sort((a, b) => b.startsAt.getTime() - a.startsAt.getTime());

  return containing[0] ?? null;
}

/** The shift that follows the one in force at an instant. */
export function nextShiftSpan(
  shifts: readonly ObservationShiftDefinition[],
  at: Date,
  timeZone: string = FACILITY_OPERATOR_TZ,
): ResolvedShiftSpan | null {
  const current = shiftSpanAt(shifts, at, timeZone);
  if (!current) return null;
  return shiftSpanAt(shifts, current.endsAt, timeZone);
}

/**
 * Every window due during a shift. A shift that crosses midnight spans two
 * service dates, so the overnight window carries the later date even though its
 * shift started the night before.
 */
export function windowsDuringShift(
  windows: readonly ObservationCadenceWindow[],
  shift: ResolvedShiftSpan,
  timeZone: string = FACILITY_OPERATOR_TZ,
): ResolvedObservationWindow[] {
  const spannedDates = [...new Set([facilityDateOf(shift.startsAt, timeZone), facilityDateOf(shift.endsAt, timeZone)])];

  return spannedDates
    .flatMap((serviceDate) => resolveObservationWindowsForDate(windows, serviceDate, timeZone))
    .filter((window) => window.shiftKey === shift.shiftKey)
    .filter((window) => window.dueAt >= shift.startsAt && window.dueAt < shift.endsAt)
    .sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime());
}

/** True when the window's due time is the start of its own shift. */
export function windowStartsItsShift(
  window: ObservationCadenceWindow,
  shifts: readonly ObservationShiftDefinition[],
): boolean {
  const dueAtLocal = normalizeLocalTime(window.dueAtLocal);
  return shifts.some(
    (shift) => shift.shiftKey === window.shiftKey && normalizeLocalTime(shift.startsAtLocal) === dueAtLocal,
  );
}
