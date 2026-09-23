/**
 * Browser-side loaders for the timeclock manager surfaces (COL-352). Every
 * read goes through RLS: managers see accessible facilities, staff see their
 * own rows. Credentials and devices are never read here; they go through the
 * admin routes.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

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
  const from = new Date(input.periodStart.getTime() - LOOKBACK_MS).toISOString();
  const to = new Date(input.periodEnd.getTime() + LOOKBACK_MS).toISOString();

  const punchesRes = await supabase
    .from("time_punches")
    .select("id, staff_id, facility_id, punch_type, punched_at, device_time, captured_offline, flags")
    .eq("facility_id", input.facilityId)
    .gte("punched_at", from)
    .lt("punched_at", to)
    .order("punched_at", { ascending: true })
    .limit(5000);
  fail(punchesRes.error);
  const punches = (punchesRes.data ?? []) as RawPunch[];

  const homeRes = await supabase
    .from("staff")
    .select("id, first_name, last_name, preferred_name, employment_status, facility_id")
    .eq("facility_id", input.facilityId)
    .is("deleted_at", null)
    .order("last_name", { ascending: true })
    .limit(1000);
  fail(homeRes.error);
  const staffMap = new Map<string, TimeclockStaff>();
  for (const row of homeRes.data ?? []) {
    staffMap.set(row.id, { id: row.id, name: staffName(row), firstName: row.first_name, lastName: row.last_name, employmentStatus: row.employment_status, facilityId: row.facility_id });
  }
  const visitorIds = [...new Set(punches.map((p) => p.staff_id))].filter((id) => !staffMap.has(id));
  if (visitorIds.length > 0) {
    const visitorsRes = await supabase
      .from("staff")
      .select("id, first_name, last_name, preferred_name, employment_status, facility_id")
      .in("id", visitorIds)
      .is("deleted_at", null);
    fail(visitorsRes.error);
    for (const row of visitorsRes.data ?? []) {
      staffMap.set(row.id, { id: row.id, name: staffName(row), firstName: row.first_name, lastName: row.last_name, employmentStatus: row.employment_status, facilityId: row.facility_id });
    }
  }
  const staffIds = [...staffMap.keys()];

  let corrections: RawCorrection[] = [];
  let rejections: RawSyncRejection[] = [];
  let floorUnlocks: RawFloorUnlock[] = [];
  if (staffIds.length > 0) {
    const correctionsRes = await supabase
      .from("time_punch_corrections")
      .select("id, staff_id, correction_type, target_punch_id, target_correction_id, punch_type, corrected_punched_at, exception_key, reason, note, corrected_by, corrected_at")
      .in("staff_id", staffIds)
      .order("corrected_at", { ascending: true })
      .limit(5000);
    fail(correctionsRes.error);
    corrections = (correctionsRes.data ?? []) as RawCorrection[];

    const rejectionsRes = await supabase
      .from("timeclock_sync_rejections")
      .select("id, staff_id, punch_type, device_time, reason, created_at")
      .eq("facility_id", input.facilityId)
      .gte("created_at", from)
      .lt("created_at", to)
      .limit(1000);
    fail(rejectionsRes.error);
    rejections = (rejectionsRes.data ?? []) as RawSyncRejection[];

    // Only off-clock unlocks become exceptions (unlock_without_punch).
    const unlocksRes = await supabase
      .from("floor_unlocks")
      .select("id, staff_id, started_at, on_clock")
      .eq("facility_id", input.facilityId)
      .eq("on_clock", false)
      .gte("started_at", from)
      .lt("started_at", to)
      .limit(1000);
    fail(unlocksRes.error);
    floorUnlocks = (unlocksRes.data ?? []) as RawFloorUnlock[];
  }

  return { staff: [...staffMap.values()].sort((a, b) => a.lastName.localeCompare(b.lastName) || a.firstName.localeCompare(b.firstName)), punches, corrections, rejections, floorUnlocks };
}

/** One person, all facilities, for the tier 2 timesheet. */
export async function loadStaffTimeclock(
  supabase: Client,
  input: { staffId: string; periodStart: Date; periodEnd: Date },
): Promise<{ staff: TimeclockStaff | null; punches: RawPunch[]; corrections: RawCorrection[]; rejections: RawSyncRejection[]; floorUnlocks: RawFloorUnlock[] }> {
  const from = new Date(input.periodStart.getTime() - LOOKBACK_MS).toISOString();
  const to = new Date(input.periodEnd.getTime() + LOOKBACK_MS).toISOString();
  const staffRes = await supabase
    .from("staff")
    .select("id, first_name, last_name, preferred_name, employment_status, facility_id")
    .eq("id", input.staffId)
    .is("deleted_at", null)
    .maybeSingle();
  fail(staffRes.error);
  const staff = staffRes.data
    ? { id: staffRes.data.id, name: staffName(staffRes.data), firstName: staffRes.data.first_name, lastName: staffRes.data.last_name, employmentStatus: staffRes.data.employment_status, facilityId: staffRes.data.facility_id }
    : null;
  const punchesRes = await supabase
    .from("time_punches")
    .select("id, staff_id, facility_id, punch_type, punched_at, device_time, captured_offline, flags")
    .eq("staff_id", input.staffId)
    .gte("punched_at", from)
    .lt("punched_at", to)
    .order("punched_at", { ascending: true })
    .limit(2000);
  fail(punchesRes.error);
  const correctionsRes = await supabase
    .from("time_punch_corrections")
    .select("id, staff_id, correction_type, target_punch_id, target_correction_id, punch_type, corrected_punched_at, exception_key, reason, note, corrected_by, corrected_at")
    .eq("staff_id", input.staffId)
    .order("corrected_at", { ascending: true })
    .limit(2000);
  fail(correctionsRes.error);
  const rejectionsRes = await supabase
    .from("timeclock_sync_rejections")
    .select("id, staff_id, punch_type, device_time, reason, created_at")
    .eq("staff_id", input.staffId)
    .gte("created_at", from)
    .lt("created_at", to)
    .limit(500);
  fail(rejectionsRes.error);
  const unlocksRes = await supabase
    .from("floor_unlocks")
    .select("id, staff_id, started_at, on_clock")
    .eq("staff_id", input.staffId)
    .eq("on_clock", false)
    .gte("started_at", from)
    .lt("started_at", to)
    .limit(500);
  fail(unlocksRes.error);
  return {
    staff,
    punches: (punchesRes.data ?? []) as RawPunch[],
    corrections: (correctionsRes.data ?? []) as RawCorrection[],
    rejections: (rejectionsRes.data ?? []) as RawSyncRejection[],
    floorUnlocks: (unlocksRes.data ?? []) as RawFloorUnlock[],
  };
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
