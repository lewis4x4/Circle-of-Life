/**
 * Supabase reads for the "Something happened" flow (spec 07A §2 tap 1 and the
 * receipt). Every `as never` cast lives here until `src/types/database.ts` is
 * regenerated for migrations 400 to 403; components never cast.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { fetchActiveResidentsWithRooms, type ResidentWithRoom } from "@/lib/caregiver/facility-residents";
import { currentShiftFor, type FacilityShiftDefinition, type ShiftType } from "@/lib/caregiver/shift";
import { fetchScheduleAssignmentIntervals } from "@/lib/schedules/assignment-context";
import type { Database } from "@/types/database";

import type { CareEventContext, CareEventKind, CareEventLevel } from "./level-engine";
import type { DeliveryLineInput } from "./receipt-copy";
import type { ReportResident } from "./report-state";
import type { CareEventDeliveryChannel, CareEventDeliveryStatus } from "./submit";

type Client = SupabaseClient<Database>;

export function toReportResident(row: ResidentWithRoom): ReportResident {
  return {
    id: row.id,
    displayName: row.displayName,
    firstName: row.first_name,
    lastName: row.last_name,
    roomLabel: row.roomLabel,
  };
}

/** The facility's active census, in the flow's shape. */
export async function fetchEveryone(supabase: Client, facilityId: string): Promise<ReportResident[]> {
  const rows = await fetchActiveResidentsWithRooms(supabase, facilityId, 200);
  return rows.map(toReportResident);
}

// ---------------------------------------------------------------------------
// My residents (today's shift assignment for the signed-in staff row)
// ---------------------------------------------------------------------------

export type ShiftAssignmentLite = {
  shift_type: string;
  assigned_resident_ids: string[] | null;
  status: string;
};

const CANCELLED_ASSIGNMENT_STATUSES: readonly string[] = ["called_out", "no_show"];

/** Rows have already been scoped to the person's published work interval. */
export function selectAssignedResidentIds(rows: ShiftAssignmentLite[]): string[] {
  return [...new Set(rows.filter((row) => !CANCELLED_ASSIGNMENT_STATUSES.includes(row.status)).flatMap((row) => row.assigned_resident_ids ?? []))];
}

/** Keep census order, restricted to the assigned ids. */
export function filterMyResidents<T extends { id: string }>(everyone: T[], assignedIds: readonly string[]): T[] {
  if (assignedIds.length === 0) return [];
  const wanted = new Set(assignedIds);
  return everyone.filter((resident) => wanted.has(resident.id));
}

export async function fetchMyResidentIds(
  supabase: Client,
  input: { userId: string; facilityId: string; timeZone: string; shifts?: readonly FacilityShiftDefinition[] | null; now?: Date },
): Promise<string[]> {
  const at = input.now ?? new Date();
  const staff = await supabase.from("staff").select("id").eq("user_id", input.userId).is("deleted_at", null).maybeSingle();
  if (staff.error) throw staff.error;
  if (!staff.data) return [];
  const intervals = await fetchScheduleAssignmentIntervals(supabase, {
    facilityId: input.facilityId, staffId: staff.data.id, from: at, to: new Date(at.getTime() + 1),
  });
  if (!intervals.length) return [];
  // Patient lists stay behind assignment RLS; the shared planned-context RPC does not expose them.
  const assignments = await supabase.from("shift_assignments")
    .select("shift_type, assigned_resident_ids, status")
    .in("id", intervals.map((row) => row.assignment_id))
    .eq("staff_id", staff.data.id).eq("facility_id", input.facilityId).is("deleted_at", null);
  if (assignments.error) throw assignments.error;
  return selectAssignedResidentIds(assignments.data ?? []);
}

// ---------------------------------------------------------------------------
// Location chips (observation_vocab, field_name = 'location')
// ---------------------------------------------------------------------------

export type LocationVocabRow = {
  value_code: string;
  display_label: string;
  display_order: number;
  is_oof: boolean;
  facility_id: string | null;
};

export type LocationChip = { code: string; label: string };

export const LOCATION_CHIP_LIMIT = 6;

/** Non-OOF rows, facility-specific first, then org-wide, by display_order; first six, unique by code. */
export function selectLocationChips(
  rows: LocationVocabRow[],
  facilityId: string,
  limit = LOCATION_CHIP_LIMIT,
): LocationChip[] {
  const rank = (row: LocationVocabRow) => (row.facility_id === facilityId ? 0 : row.facility_id === null ? 1 : 2);
  const sorted = rows
    .filter((row) => !row.is_oof && (row.facility_id === facilityId || row.facility_id === null))
    .sort((a, b) => rank(a) - rank(b) || a.display_order - b.display_order || a.display_label.localeCompare(b.display_label));
  const seen = new Set<string>();
  const chips: LocationChip[] = [];
  for (const row of sorted) {
    if (seen.has(row.value_code)) continue;
    seen.add(row.value_code);
    chips.push({ code: row.value_code, label: row.display_label });
    if (chips.length >= limit) break;
  }
  return chips;
}

export async function fetchLocationChips(supabase: Client, facilityId: string): Promise<LocationChip[]> {
  const result = await supabase
    .from("observation_vocab" as never)
    .select("value_code, display_label, display_order, is_oof, facility_id")
    .eq("field_name", "location")
    .eq("active", true)
    .is("deleted_at", null)
    .or(`facility_id.eq.${facilityId},facility_id.is.null`);
  if (result.error) throw result.error;
  return selectLocationChips((result.data ?? []) as LocationVocabRow[], facilityId);
}

// ---------------------------------------------------------------------------
// Resident context for the level engine
// ---------------------------------------------------------------------------

export type ResidentReportContext = Pick<
  CareEventContext,
  "active_watch" | "elopement_risk" | "prior_unexplained_bruise_30d"
> & { fall_risk_level: string | null };

export async function fetchResidentReportContext(
  supabase: Client,
  residentId: string,
  now: Date = new Date(),
): Promise<ResidentReportContext> {
  const since = new Date(now.getTime() - 30 * 24 * 60 * 60_000).toISOString();
  const [resident, watches, bruises] = await Promise.all([
    supabase
      .from("residents" as never)
      .select("fall_risk_level, elopement_risk")
      .eq("id", residentId)
      .maybeSingle(),
    supabase
      .from("resident_watch_instances" as never)
      .select("id, ends_at")
      .eq("resident_id", residentId)
      .in("status", ["active", "pending_approval"])
      .is("deleted_at", null),
    supabase
      .from("care_events" as never)
      .select("id")
      .eq("resident_id", residentId)
      .eq("category", "unexplained_bruise")
      .gte("occurred_at", since)
      .is("deleted_at", null)
      .limit(1),
  ]);
  if (resident.error) throw resident.error;
  if (watches.error) throw watches.error;
  if (bruises.error) throw bruises.error;
  const residentRow = resident.data as { fall_risk_level: string | null; elopement_risk: boolean } | null;
  const watchRows = (watches.data ?? []) as { id: string; ends_at: string | null }[];
  const activeWatch = watchRows.some((row) => !row.ends_at || new Date(row.ends_at).getTime() > now.getTime());
  return {
    active_watch: activeWatch,
    elopement_risk: residentRow?.elopement_risk === true,
    prior_unexplained_bruise_30d: ((bruises.data ?? []) as { id: string }[]).length > 0,
    fall_risk_level: residentRow?.fall_risk_level ?? null,
  };
}

// ---------------------------------------------------------------------------
// On-call phone (cached for the offline receipt)
// ---------------------------------------------------------------------------

export type OnCallCandidate = {
  shift_type: string;
  is_primary: boolean;
  phone_override: string | null;
  staff_phone: string | null;
};

/** Current shift first, primary before secondary, `phone_override` over the staff phone. */
export function selectOnCallPhone(rows: OnCallCandidate[], currentShift: ShiftType): string | null {
  const rank = (row: OnCallCandidate) =>
    (row.shift_type === currentShift ? 0 : 10) + (row.is_primary ? 0 : 1);
  const sorted = [...rows].sort((a, b) => rank(a) - rank(b));
  for (const row of sorted) {
    const phone = row.phone_override?.trim() || row.staff_phone?.trim() || "";
    if (phone) return phone;
  }
  return null;
}

export async function fetchOnCallPhone(
  supabase: Client,
  input: { facilityId: string; timeZone: string; shifts?: readonly FacilityShiftDefinition[] | null; now?: Date },
): Promise<string | null> {
  const shift = currentShiftFor({ timeZone: input.timeZone, shifts: input.shifts }, input.now ?? new Date());
  const schedules = await supabase
    .from("on_call_schedules" as never)
    .select("staff_id, shift_type, is_primary, phone_override")
    .eq("facility_id", input.facilityId)
    .eq("shift_date", shift.serviceDate)
    .is("deleted_at", null);
  if (schedules.error) throw schedules.error;
  const rows = (schedules.data ?? []) as {
    staff_id: string;
    shift_type: string;
    is_primary: boolean;
    phone_override: string | null;
  }[];
  if (rows.length === 0) return null;
  const staffIds = [...new Set(rows.map((row) => row.staff_id))];
  const staff = await supabase.from("staff" as never).select("id, phone").in("id", staffIds);
  if (staff.error) throw staff.error;
  const phoneByStaff = new Map(((staff.data ?? []) as { id: string; phone: string | null }[]).map((row) => [row.id, row.phone]));
  return selectOnCallPhone(
    rows.map((row) => ({
      shift_type: row.shift_type,
      is_primary: row.is_primary,
      phone_override: row.phone_override,
      staff_phone: phoneByStaff.get(row.staff_id) ?? null,
    })),
    shift.shiftType,
  );
}

export const onCallCacheKey = (facilityId: string) => `haven:care-events:on-call:${facilityId}`;

export function cacheOnCallPhone(facilityId: string, phone: string | null): void {
  if (typeof window === "undefined") return;
  try {
    if (phone) window.localStorage.setItem(onCallCacheKey(facilityId), phone);
    else window.localStorage.removeItem(onCallCacheKey(facilityId));
  } catch {
    // Storage may be unavailable in private mode. The receipt falls back to the unavailable line.
  }
}

export function readCachedOnCallPhone(facilityId: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(onCallCacheKey(facilityId));
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Receipt polling and revisit
// ---------------------------------------------------------------------------

export type CareEventReceiptStatus = {
  careEventId: string;
  status: "open" | "acknowledged" | "closed";
  kind: CareEventKind;
  level: CareEventLevel;
  sentence: string;
  note: string | null;
  occurredAt: string;
  createdAt: string;
  acknowledgedAt: string | null;
  acknowledgedByName: string | null;
  incidentId: string | null;
  incidentNumber: string | null;
  nextCheckAt: string | null;
  resident: { id: string; firstName: string | null; lastName: string | null } | null;
  deliveries: DeliveryLineInput[];
};

type CareEventRow = {
  id: string;
  status: string;
  kind: string;
  final_level: string;
  sentence: string;
  note: string | null;
  occurred_at: string;
  created_at: string;
  acknowledged_at: string | null;
  acknowledged_by: string | null;
  incident_id: string | null;
  resident_id: string | null;
  reported_by: string;
};

type DeliveryRow = {
  channel: CareEventDeliveryChannel;
  status: CareEventDeliveryStatus;
  target_user_id: string | null;
  target_role: string | null;
  sent_at: string | null;
  acknowledged_at: string | null;
  skip_reason: string | null;
};

function levelFromSeverity(value: string): CareEventLevel {
  const match = /([1-4])$/.exec(value);
  const number = match ? Number(match[1]) : 1;
  return (number === 2 || number === 3 || number === 4 ? number : 1) as CareEventLevel;
}

export async function fetchCareEventReceiptStatus(
  supabase: Client,
  careEventId: string,
): Promise<CareEventReceiptStatus | null> {
  const event = await supabase
    .from("care_events" as never)
    .select(
      "id, status, kind, final_level, sentence, note, occurred_at, created_at, acknowledged_at, acknowledged_by, incident_id, resident_id, reported_by",
    )
    .eq("id", careEventId)
    .is("deleted_at", null)
    .maybeSingle();
  if (event.error) throw event.error;
  const row = event.data as CareEventRow | null;
  if (!row) return null;

  const [deliveries, incident, resident, followups] = await Promise.all([
    supabase
      .from("care_event_deliveries" as never)
      .select("channel, status, target_user_id, target_role, sent_at, acknowledged_at, skip_reason")
      .eq("care_event_id", careEventId)
      .order("created_at", { ascending: true }),
    row.incident_id
      ? supabase.from("incidents" as never).select("incident_number").eq("id", row.incident_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    row.resident_id
      ? supabase.from("residents" as never).select("id, first_name, last_name").eq("id", row.resident_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    row.incident_id
      ? supabase
          .from("incident_followups" as never)
          .select("due_at")
          .eq("incident_id", row.incident_id)
          .eq("assigned_to", row.reported_by)
          .is("completed_at", null)
          .is("deleted_at", null)
          .order("due_at", { ascending: true })
          .limit(1)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (deliveries.error) throw deliveries.error;
  if (incident.error) throw incident.error;
  if (resident.error) throw resident.error;
  if (followups.error) throw followups.error;

  const deliveryRows = (deliveries.data ?? []) as DeliveryRow[];
  const profileIds = new Set<string>();
  for (const delivery of deliveryRows) if (delivery.target_user_id) profileIds.add(delivery.target_user_id);
  if (row.acknowledged_by) profileIds.add(row.acknowledged_by);
  const nameById = new Map<string, string | null>();
  if (profileIds.size > 0) {
    const profiles = await supabase
      .from("user_profiles" as never)
      .select("id, full_name")
      .in("id", [...profileIds]);
    if (profiles.error) throw profiles.error;
    for (const profile of (profiles.data ?? []) as { id: string; full_name: string | null }[]) {
      nameById.set(profile.id, profile.full_name);
    }
  }

  const residentRow = resident.data as { id: string; first_name: string | null; last_name: string | null } | null;
  const incidentRow = incident.data as { incident_number: string | null } | null;
  const nextFollowup = ((followups.data ?? []) as { due_at: string }[])[0] ?? null;
  const status = row.status === "acknowledged" || row.status === "closed" ? row.status : "open";

  return {
    careEventId: row.id,
    status,
    kind: row.kind as CareEventKind,
    level: levelFromSeverity(row.final_level),
    sentence: row.sentence,
    note: row.note,
    occurredAt: row.occurred_at,
    createdAt: row.created_at,
    acknowledgedAt: row.acknowledged_at,
    acknowledgedByName: row.acknowledged_by ? (nameById.get(row.acknowledged_by) ?? null) : null,
    incidentId: row.incident_id,
    incidentNumber: incidentRow?.incident_number ?? null,
    nextCheckAt: nextFollowup?.due_at ?? null,
    resident: residentRow
      ? { id: residentRow.id, firstName: residentRow.first_name, lastName: residentRow.last_name }
      : null,
    deliveries: deliveryRows.map((delivery) => ({
      target_name: delivery.target_user_id ? (nameById.get(delivery.target_user_id) ?? null) : null,
      target_role: delivery.target_role,
      channel: delivery.channel,
      status: delivery.status,
      sent_at: delivery.sent_at,
      skip_reason: delivery.skip_reason,
    })),
  };
}
