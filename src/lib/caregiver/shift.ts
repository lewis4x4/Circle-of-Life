import type { SupabaseClient } from "@supabase/supabase-js";

import { facilityDateOf, nextShiftSpan, shiftSpanAt, type ObservationShiftDefinition } from "@/lib/rounding/observation-cadence";
import type { Database } from "@/types/database";

export type ShiftType = Database["public"]["Enums"]["shift_type"];

/**
 * One configured shift for a facility (`facility_shift_definitions`), the same
 * rows the caregiver header and the rounding board read. `rosterShiftType` is
 * the stored mapping onto the roster enum — never inferred from the key.
 */
export type FacilityShiftDefinition = ObservationShiftDefinition & { rosterShiftType: ShiftType };

export type CurrentShift = {
  /** Roster enum value written onto logs, notes and assignments. */
  shiftType: ShiftType;
  /** Display label, e.g. "Day". */
  label: string;
  /** Facility date the shift started on; an overnight shift keeps the evening it began. */
  serviceDate: string;
  /** When the shift started. */
  startsAt: Date;
  /** When the shift ends. */
  endsAt: Date;
  /** False when the facility has no shift definitions covering this instant. */
  configured: boolean;
};

const SHIFT_LABELS: Record<string, string> = { day: "Day", evening: "Evening", night: "Night" };

const LEGACY_BUCKETS: ReadonlyArray<{ shiftType: ShiftType; startHour: number; endHour: number }> = [
  { shiftType: "day", startHour: 7, endHour: 15 },
  { shiftType: "evening", startHour: 15, endHour: 23 },
  { shiftType: "night", startHour: 23, endHour: 7 },
];

/**
 * Legacy fixed 8-hour buckets (7a / 3p / 11p). Used only when a facility has no
 * `facility_shift_definitions` covering the instant; every Circle of Life
 * building has definitions today, so this path should not render in production.
 * Expressed as shift definitions so the fallback resolves spans (start, end,
 * service date) exactly like a configured facility.
 */
const LEGACY_SHIFT_DEFINITIONS: FacilityShiftDefinition[] = LEGACY_BUCKETS.map((bucket, index) => ({
  shiftKey: `legacy_${bucket.shiftType}`,
  label: SHIFT_LABELS[bucket.shiftType] ?? bucket.shiftType,
  startsAtLocal: `${String(bucket.startHour).padStart(2, "0")}:00:00`,
  endsAtLocal: `${String(bucket.endHour).padStart(2, "0")}:00:00`,
  sortOrder: index,
  rosterShiftType: bucket.shiftType,
}));

function spanShift(
  shifts: readonly FacilityShiftDefinition[],
  now: Date,
  timeZone: string,
  configured: boolean,
): CurrentShift | null {
  const span = shiftSpanAt(shifts, now, timeZone);
  const definition = span ? shifts.find((shift) => shift.shiftKey === span.shiftKey) : undefined;
  if (!span || !definition) return null;
  return {
    shiftType: definition.rosterShiftType,
    label: span.label,
    serviceDate: span.serviceDate,
    startsAt: span.startsAt,
    endsAt: span.endsAt,
    configured,
  };
}

function legacyShiftAt(timeZone: string, now: Date): CurrentShift {
  const resolved = spanShift(LEGACY_SHIFT_DEFINITIONS, now, timeZone, false);
  if (resolved) return resolved;
  // Unreachable: the three buckets cover every hour of the day.
  return { shiftType: "night", label: "Night", serviceDate: facilityDateOf(now, timeZone), startsAt: now, endsAt: now, configured: false };
}

/**
 * The shift in force for a facility, from its configured definitions. The
 * caregiver header, the caregiver pages and the handoff board all call this, so
 * they cannot disagree (COL-659: the header said "Day shift" at 5:14 PM from the
 * facility's 6a/6p definitions while the page said "EVENING SHIFT" from a
 * hard-coded 7/15/23 model).
 */
export function currentShiftFor(
  facility: { timeZone: string; shifts?: readonly FacilityShiftDefinition[] | null },
  now: Date = new Date(),
): CurrentShift {
  const shifts = facility.shifts ?? [];
  return (shifts.length > 0 ? spanShift(shifts, now, facility.timeZone, true) : null) ?? legacyShiftAt(facility.timeZone, now);
}

/** The configured shift that follows the one in force, or null when shifts are not configured. */
export function nextShiftFor(
  facility: { timeZone: string; shifts?: readonly FacilityShiftDefinition[] | null },
  now: Date = new Date(),
): CurrentShift | null {
  const shifts = facility.shifts ?? [];
  if (shifts.length === 0) return null;
  const span = nextShiftSpan(shifts, now, facility.timeZone);
  return span ? spanShift(shifts, span.startsAt, facility.timeZone, true) : null;
}

/** The shift enum a handoff row can store: day, evening or night. */
export type HandoffShiftType = Exclude<ShiftType, "custom">;

/**
 * A roster shift for a `shift_handoffs` row, which cannot store "custom". A
 * custom definition is filed under the fixed bucket its start falls in; every
 * Circle of Life building maps its shifts onto day and night today.
 */
export function handoffShiftOf(shift: CurrentShift, timeZone: string): HandoffShiftType {
  if (shift.shiftType !== "custom") return shift.shiftType;
  return legacyShiftAt(timeZone, shift.startsAt).shiftType as HandoffShiftType;
}

type ShiftDefinitionRow = {
  facility_id: string;
  shift_key: string;
  label: string;
  starts_at_local: string;
  ends_at_local: string;
  sort_order: number | null;
  roster_shift_type: ShiftType;
};

/** Active shift definitions for the given facilities, keyed by facility id. */
export async function fetchFacilityShiftDefinitions(
  supabase: SupabaseClient<Database>,
  facilityIds: readonly string[],
): Promise<Map<string, FacilityShiftDefinition[]>> {
  const byFacility = new Map<string, FacilityShiftDefinition[]>();
  if (facilityIds.length === 0) return byFacility;
  const { data, error } = await supabase
    .from("facility_shift_definitions" as never)
    .select("facility_id, shift_key, label, starts_at_local, ends_at_local, sort_order, roster_shift_type")
    .in("facility_id", facilityIds as string[])
    .eq("active", true)
    .is("deleted_at", null)
    .order("sort_order", { ascending: true });
  if (error) throw error;
  for (const row of (data ?? []) as unknown as ShiftDefinitionRow[]) {
    const list = byFacility.get(row.facility_id) ?? [];
    list.push({
      shiftKey: row.shift_key,
      label: row.label,
      startsAtLocal: row.starts_at_local,
      endsAtLocal: row.ends_at_local,
      sortOrder: row.sort_order ?? list.length,
      rosterShiftType: row.roster_shift_type,
    });
    byFacility.set(row.facility_id, list);
  }
  return byFacility;
}
