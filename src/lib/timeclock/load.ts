/**
 * Browser-side loaders for the timeclock manager surfaces (COL-352). Every
 * read goes through RLS: managers see accessible facilities, staff see their
 * own rows. Credentials and devices are never read here; they go through the
 * admin routes.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { mapWithConcurrency } from "@/lib/rounding/compliance-day-chunks";
import { readAllPages } from "@/lib/supabase/read-all-pages";
import type { PayPeriodSettings, RawCorrection, RawFloorUnlock, RawPunch, RawSyncRejection } from "@/lib/timeclock/compute";
import type { Database } from "@/types/database";

export type TimeclockStaff = {
  id: string;
  name: string;
  firstName: string;
  lastName: string;
  employmentStatus: string;
  facilityId: string;
};

export type TimeclockPeriodData = {
  staff: TimeclockStaff[];
  punches: RawPunch[];
  corrections: RawCorrection[];
  rejections: RawSyncRejection[];
  floorUnlocks: RawFloorUnlock[];
};

type Client = SupabaseClient<Database>;

const LOOKBACK_MS = 24 * 60 * 60 * 1000;
const ID_BATCH_SIZE = 100;
const ID_BATCH_CONCURRENCY = 8;
const PUNCH_COLUMNS = "id, staff_id, facility_id, punch_type, punched_at, device_time, captured_offline, flags";
const CORRECTION_COLUMNS = "id, staff_id, facility_id, correction_type, target_punch_id, target_correction_id, punch_type, corrected_punched_at, exception_key, reason, note, corrected_by, corrected_at";
const STAFF_COLUMNS = "id, first_name, last_name, preferred_name, employment_status, facility_id";
const REJECTION_COLUMNS = "id, staff_id, facility_id, punch_type, device_time, reason, created_at";
const FLOOR_UNLOCK_COLUMNS = "id, staff_id, started_at, on_clock";

type PageQuery<T> = { range: (from: number, to: number) => PromiseLike<{ data: T[] | null; count: number | null; error: { message: string } | null }> };

/** A limit above PostgREST's row cap still truncates. Read every ordered page. */
async function allPages<T>(query: () => PageQuery<T>): Promise<T[]> {
  const { data } = await readAllPages((from, to) => query().range(from, to));
  return data;
}

/** Keep ID filters small enough for URL limits; each batch can still span pages. */
async function byIds<T>(ids: string[], query: (batch: string[]) => PageQuery<T>): Promise<T[]> {
  const unique = [...new Set(ids)];
  const batches: string[][] = [];
  for (let index = 0; index < unique.length; index += ID_BATCH_SIZE) {
    batches.push(unique.slice(index, index + ID_BATCH_SIZE));
  }
  const pages = await mapWithConcurrency(batches, ID_BATCH_CONCURRENCY, (batch) => allPages(() => query(batch)));
  return pages.flat();
}

type LedgerScope = { column: "facility_id" | "staff_id"; id: string };

async function loadPeriodLedger(supabase: Client, scope: LedgerScope, periodStart: Date, periodEnd: Date) {
  const from = new Date(periodStart.getTime() - LOOKBACK_MS).toISOString();
  const to = new Date(periodEnd.getTime() + LOOKBACK_MS).toISOString();
  const punchQuery = () => supabase.from("time_punches").select(PUNCH_COLUMNS, { count: "exact" }).eq(scope.column, scope.id).order("punched_at").order("id");
  const correctionQuery = () => supabase.from("time_punch_corrections").select(CORRECTION_COLUMNS, { count: "exact" }).eq(scope.column, scope.id).order("corrected_at").order("id");
  const punches = await allPages(() => punchQuery().gte("punched_at", from).lt("punched_at", to)) as RawPunch[];
  const rejections = await allPages(() => supabase.from("timeclock_sync_rejections").select(REJECTION_COLUMNS, { count: "exact" }).eq(scope.column, scope.id).gte("created_at", from).lt("created_at", to).order("created_at").order("id")) as RawSyncRejection[];
  // Only off-clock floor unlocks become exceptions (unlock_without_punch, COL-690).
  const floorUnlocks = await allPages(() => supabase.from("floor_unlocks").select(FLOOR_UNLOCK_COLUMNS, { count: "exact" }).eq(scope.column, scope.id).eq("on_clock", false).gte("started_at", from).lt("started_at", to).order("started_at").order("id")) as RawFloorUnlock[];

  // Seed by the time worked, never corrected_at: late corrections still affect old periods.
  // Voids/acknowledgements have no corrected time, so retrieve them by their anchors below.
  const corrections = await allPages(() => correctionQuery().gte("corrected_punched_at", from).lt("corrected_punched_at", to)) as RawCorrection[];
  const punchIds = new Set(punches.map((row) => row.id));
  const correctionIds = new Set(corrections.map((row) => row.id));
  punches.push(...await byIds(corrections.flatMap((row) => row.target_punch_id && !punchIds.has(row.target_punch_id) ? [row.target_punch_id] : []), (ids) => punchQuery().in("id", ids)) as RawPunch[]);
  // The database permits target_correction_id only for an add_punch, so one ancestor read is complete.
  corrections.push(...await byIds(corrections.flatMap((row) => row.target_correction_id && !correctionIds.has(row.target_correction_id) ? [row.target_correction_id] : []), (ids) => correctionQuery().in("id", ids)) as RawCorrection[]);
  const addedIds = corrections.filter((row) => row.correction_type === "add_punch").map((row) => row.id);
  corrections.push(...await byIds(punches.map((row) => row.id), (ids) => correctionQuery().in("target_punch_id", ids)) as RawCorrection[]);
  corrections.push(...await byIds(addedIds, (ids) => correctionQuery().in("target_correction_id", ids)) as RawCorrection[]);
  const exceptionTypes = ["missing_out", "missing_meal_end", "long_shift", "clock_skew", "offline_capture", "short_turnaround"];
  const exceptionKeys = [...punches.map((row) => row.id), ...addedIds].flatMap((id) => exceptionTypes.map((type) => `${type}:${id}`));
  exceptionKeys.push(...rejections.map((row) => `rejected_offline_sync:${row.id}`));
  exceptionKeys.push(...floorUnlocks.map((row) => `unlock_without_punch:${row.id}`));
  corrections.push(...await byIds(exceptionKeys, (keys) => correctionQuery().in("exception_key", keys)) as RawCorrection[]);
  return {
    punches: punches.sort((a, b) => a.punched_at.localeCompare(b.punched_at) || a.id.localeCompare(b.id)),
    corrections: [...new Map(corrections.map((row) => [row.id, row])).values()].sort((a, b) => a.corrected_at.localeCompare(b.corrected_at) || a.id.localeCompare(b.id)),
    rejections,
    floorUnlocks,
  };
}

function staffName(row: { first_name: string; last_name: string; preferred_name: string | null }): string {
  const first = row.preferred_name?.trim() || row.first_name;
  return `${first} ${row.last_name}`.trim();
}

function fail(error: { message: string } | null): void {
  if (error) throw new Error(error.message);
}

export async function loadOrganizationPayPeriod(supabase: Client, organizationId: string): Promise<PayPeriodSettings | null> {
  const { data, error } = await supabase
    .from("timeclock_organization_settings")
    .select("timeclock_pay_period, timeclock_pay_period_anchor")
    .eq("organization_id", organizationId)
    .maybeSingle();
  fail(error);
  if (!data) return null;
  return {
    timeclock_pay_period: (data.timeclock_pay_period as PayPeriodSettings["timeclock_pay_period"]) ?? null,
    timeclock_pay_period_anchor: data.timeclock_pay_period_anchor,
  };
}

export async function loadFacilityTimeclockEnabled(supabase: Client, facilityId: string): Promise<boolean> {
  const { data, error } = await supabase.from("timeclock_facility_settings").select("timeclock_enabled").eq("facility_id", facilityId).maybeSingle();
  fail(error);
  return Boolean(data?.timeclock_enabled);
}

/** Facility view: home staff plus anyone who punched here in the period. */
export async function loadTimeclockPeriod(
  supabase: Client,
  input: { facilityId: string; periodStart: Date; periodEnd: Date },
): Promise<TimeclockPeriodData> {
  const ledger = await loadPeriodLedger(supabase, { column: "facility_id", id: input.facilityId }, input.periodStart, input.periodEnd);
  const home = await allPages(() => supabase.from("staff").select(STAFF_COLUMNS, { count: "exact" }).eq("facility_id", input.facilityId).is("deleted_at", null).order("last_name").order("id"));
  const homeIds = new Set(home.map((row) => row.id));
  // A visitor may have only an added punch or a rejected sync in this period.
  const visitorIds = [...ledger.punches, ...ledger.corrections, ...ledger.rejections, ...ledger.floorUnlocks].flatMap((row) => row.staff_id && !homeIds.has(row.staff_id) ? [row.staff_id] : []);
  const visitors = await byIds(visitorIds, (ids) => supabase.from("staff").select(STAFF_COLUMNS, { count: "exact" }).in("id", ids).is("deleted_at", null).order("id"));
  const staff = [...home, ...visitors].map((row) => ({ id: row.id, name: staffName(row), firstName: row.first_name, lastName: row.last_name, employmentStatus: row.employment_status, facilityId: row.facility_id }));
  return { staff: staff.sort((a, b) => a.lastName.localeCompare(b.lastName) || a.firstName.localeCompare(b.firstName) || a.id.localeCompare(b.id)), ...ledger };
}

/** One person, all facilities, for the tier 2 timesheet. */
export async function loadStaffTimeclock(
  supabase: Client,
  input: { staffId: string; periodStart: Date; periodEnd: Date },
): Promise<{ staff: TimeclockStaff | null; punches: RawPunch[]; corrections: RawCorrection[]; rejections: RawSyncRejection[]; floorUnlocks: RawFloorUnlock[] }> {
  const staffRes = await supabase.from("staff").select(STAFF_COLUMNS).eq("id", input.staffId).is("deleted_at", null).maybeSingle();
  fail(staffRes.error);
  const staff = staffRes.data
    ? { id: staffRes.data.id, name: staffName(staffRes.data), firstName: staffRes.data.first_name, lastName: staffRes.data.last_name, employmentStatus: staffRes.data.employment_status, facilityId: staffRes.data.facility_id }
    : null;
  const ledger = await loadPeriodLedger(supabase, { column: "staff_id", id: input.staffId }, input.periodStart, input.periodEnd);
  return { staff, ...ledger };
}

/** Employee numbers for the export and comparison, through the definer function (never the table). */
export async function loadEmployeeNumbers(supabase: Client, staffIds: string[]): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  if (staffIds.length === 0) return result;
  const { data, error } = await supabase.rpc("timeclock_employee_numbers", { p_staff_ids: staffIds });
  fail(error);
  for (const entry of Array.isArray(data) ? data : []) {
    if (entry && typeof entry === "object" && "staff_id" in entry && "employee_number" in entry) {
      const row = entry as { staff_id: string; employee_number: string };
      result.set(row.staff_id, row.employee_number);
    }
  }
  return result;
}

export const TIMECLOCK_MANAGER_ROLES = new Set(["owner", "org_admin", "facility_admin"]);
export const TIMECLOCK_SETTINGS_ROLES = new Set(["owner", "org_admin"]);

export function canReviewTimeclock(appRole: string): boolean {
  return TIMECLOCK_MANAGER_ROLES.has(appRole);
}

export function canChangeTimeclockSettings(appRole: string): boolean {
  return TIMECLOCK_SETTINGS_ROLES.has(appRole);
}
