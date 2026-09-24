import type { SupabaseClient } from "@supabase/supabase-js";
import { scheduleWallTime } from "./week-grid";
import { addFacilityCalendarDays, FACILITY_OPERATOR_TZ } from "@/lib/facility-wall-clock";
import { enumLabel } from "@/lib/display/enum-label";
import { readAllPages } from "@/lib/supabase/read-all-pages";
import type { Database } from "@/types/database";

/** Published work, not a clinical cadence window or evidence of a clock punch. */
export type ScheduleAssignmentInterval = {
  assignment_id: string; schedule_id: string; staff_id: string; facility_id: string;
  service_date: string; starts_at: string; ends_at: string; time_zone: string;
  preset_id: string | null; preset_version: number | null; label: string; color: string | null;
  staff_role: string | null; group_id: string | null; block_index: number | null; block_count: number | null;
  legacy_shift_type: string; status: string; is_legacy: boolean; rounding_coverage?: boolean | null;
};

/** Optional while old published rows retain their original evidence unchanged. */
export type AssignmentSnapshot = {
  schedule_preset_id?: string | null; schedule_preset_name?: string | null; schedule_preset_color?: string | null;
  schedule_preset_version?: number | null; schedule_role_snapshot?: string | null; schedule_time_zone?: string | null;
  schedule_starts_at?: string | null; schedule_ends_at?: string | null;
  schedule_rounding_coverage?: boolean | null;
  schedule_group_id?: string | null; schedule_block_index?: number | null; schedule_block_count?: number | null;
};

export const ASSIGNMENT_SNAPSHOT_SELECT = "schedule_preset_id, schedule_preset_name, schedule_preset_color, schedule_preset_version, schedule_role_snapshot, schedule_time_zone, schedule_starts_at, schedule_ends_at, schedule_group_id, schedule_block_index, schedule_block_count, schedule_rounding_coverage";

export function assignmentLabel(row: AssignmentSnapshot & { shift_type?: string | null }): string {
  return row.schedule_preset_name?.trim() || enumLabel(row.shift_type || "custom");
}

export function assignmentIntervalSpan(row: AssignmentSnapshot & {
  shift_date: string; shift_type?: string | null; custom_start_time: string | null; custom_end_time: string | null;
}, fallbackTimeZone = FACILITY_OPERATOR_TZ) {
  const timeZone = row.schedule_time_zone || fallbackTimeZone;
  const snapshotPresent = row.schedule_starts_at != null || row.schedule_ends_at != null;
  if (snapshotPresent && (!row.schedule_starts_at || !row.schedule_ends_at)) return null;
  if (!snapshotPresent && (!row.custom_start_time || !row.custom_end_time || row.custom_start_time === row.custom_end_time)) return null;
  const start = snapshotPresent ? new Date(row.schedule_starts_at!) : scheduleWallTime(row.shift_date, row.custom_start_time!, timeZone);
  const endDate = !snapshotPresent && row.custom_end_time! <= row.custom_start_time!
    ? addFacilityCalendarDays(row.shift_date, 1, timeZone) : row.shift_date;
  const end = snapshotPresent ? new Date(row.schedule_ends_at!) : scheduleWallTime(endDate, row.custom_end_time!, timeZone);
  if (!start || !end || !Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start) return null;
  return { start, end, label: assignmentLabel(row), color: row.schedule_preset_color ?? null, timeZone, isLegacy: !snapshotPresent };
}

export function currentAssignmentInterval(rows: readonly ScheduleAssignmentInterval[], at = new Date()): ScheduleAssignmentInterval | null {
  const matches = rows.filter((row) => new Date(row.starts_at) <= at && at < new Date(row.ends_at));
  // Do not disguise conflicting work intervals as a valid single current shift.
  return matches.length === 1 ? matches[0] : null;
}

export function nextAssignmentInterval(rows: readonly ScheduleAssignmentInterval[], at = new Date()): ScheduleAssignmentInterval | null {
  return rows.filter((row) => new Date(row.starts_at) > at).sort((a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime())[0] ?? null;
}

export function formatAssignmentInterval(row: Pick<ScheduleAssignmentInterval, "label" | "time_zone" | "starts_at" | "ends_at">): string {
  const formatter = new Intl.DateTimeFormat("en-US", { timeZone: row.time_zone, hour: "numeric", minute: "2-digit" });
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: row.time_zone, year: "numeric", month: "2-digit", day: "2-digit" });
  const start = new Date(row.starts_at); const end = new Date(row.ends_at);
  const rollover = date.format(start) === date.format(end) ? "" : ` (ends ${date.format(end)})`;
  return `${row.label} · ${formatter.format(start)}–${formatter.format(end)}${rollover} · ${row.time_zone}`;
}

export async function fetchScheduleAssignmentIntervals(client: Pick<SupabaseClient<Database>, "rpc">, input: {
  facilityId: string | null; from: Date | string; to: Date | string; staffId?: string | null;
}): Promise<ScheduleAssignmentInterval[]> {
  if (!input.facilityId && !input.staffId) throw new Error("A facility or verified staff scope is required.");
  const from = new Date(input.from); const to = new Date(input.to);
  if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || to <= from) throw new Error("A valid assignment interval is required.");
  const result = await readAllPages<ScheduleAssignmentInterval>(async (start, end) => {
    const page = await client.rpc("schedule_assignment_intervals" as never, {
      p_facility_id: input.facilityId, p_from: from.toISOString(), p_to: to.toISOString(), p_staff_id: input.staffId ?? null,
    } as never, { count: "exact" }).order("starts_at").order("assignment_id").range(start, end);
    return { data: page.data as unknown as ScheduleAssignmentInterval[] | null, count: page.count, error: page.error };
  });
  return result.data;
}

/** Resolve the signed-in person's exact staff identity; ambiguity is not an assignment. */
export async function fetchUserAssignmentIntervals(client: SupabaseClient<Database>, input: {
  userId: string; facilityId: string; from: Date | string; to: Date | string;
}): Promise<ScheduleAssignmentInterval[]> {
  const staff = await client.from("staff").select("id").eq("user_id", input.userId).is("deleted_at", null).maybeSingle();
  if (staff.error) throw staff.error;
  if (!staff.data) return [];
  return fetchScheduleAssignmentIntervals(client, { ...input, staffId: staff.data.id });
}
