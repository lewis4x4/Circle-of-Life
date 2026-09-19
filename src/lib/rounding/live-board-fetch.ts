import { readAllPages } from "@/lib/supabase/read-all-pages";
/**
 * Reads for the Smart Rounding Live board. Spec 25A section 8, defects 1, 2,
 * 3, 5 and 6.
 *
 * Four separate reads rather than one wide embed, on purpose.
 *
 * The deployed board asked for
 * `residents(first_name, last_name, preferred_name, room_number)` and
 * `staff:assigned_staff_id(...)` in a single select. Both are wrong against the
 * real schema. `residents.room_number` does not exist, so PostgREST answered
 * `42703` and the entire query failed; room lives on `rooms.room_number`,
 * reached `residents.bed_id` to `beds.room_id` to `rooms`. And
 * `resident_observation_tasks` holds two foreign keys to `staff`
 * (`assigned_staff_id` and `reassigned_from_staff_id`), which makes a bare or
 * alias-prefixed embed ambiguous; the disambiguation PostgREST accepts is the
 * constraint name after a `!`.
 *
 * Splitting the roster out of the task read has a second payoff: the board
 * holds the facility's active roster as a first class number, which is what
 * acceptance item 12 asserts, and a resident whose name the board could not
 * resolve reads as a gap rather than taking the whole board down with it.
 *
 * Every read here filters the selected facility explicitly. Row level security
 * filters it again through `haven.accessible_facility_ids()`, so a reader who
 * can reach one building gets one building whatever this file asks for. The
 * explicit filter is what makes the board show the *selected* building rather
 * than every building the reader can reach.
 *
 * No window time, grace value or shift boundary appears in this file. Windows
 * and shifts are rows.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * How much history the board keeps on screen, as service dates rather than a
 * duration.
 *
 * An earlier board held a twelve hour lookback as a millisecond literal, which
 * is the shift length written into code in a module whose whole point is that
 * shift lengths are rows. `service_date` is stamped on both cadence tasks and
 * Monitoring Order tasks, so yesterday and today is the same window expressed
 * in the building's own calendar and carries no configuration value.
 */
export const LIVE_BOARD_SERVICE_DATE_SPAN_DAYS = 1;

const TASK_SELECT = [
  "id",
  "organization_id",
  "facility_id",
  "resident_id",
  "due_at",
  "grace_ends_at",
  "status",
  "window_key",
  "service_date",
  "monitoring_order_id",
  "assigned_staff_id",
  "escalated_at",
  "staff!resident_observation_tasks_assigned_staff_id_fkey(first_name, last_name, preferred_name)",
].join(", ");

const ROSTER_SELECT = [
  "id",
  "first_name",
  "last_name",
  "preferred_name",
  "status",
  "beds!residents_bed_id_fkey(rooms(room_number))",
].join(", ");

const ESCALATION_SELECT = [
  "id",
  "task_id",
  "resident_id",
  "escalation_level",
  "escalation_type",
  "rung_key",
  "status",
  "triggered_at",
  "acknowledged_at",
].join(", ");

export type LiveBoardTaskRow = {
  id: string;
  organization_id: string;
  facility_id: string;
  resident_id: string;
  due_at: string;
  grace_ends_at: string;
  status: string;
  window_key: string | null;
  service_date: string | null;
  monitoring_order_id: string | null;
  assigned_staff_id: string | null;
  escalated_at: string | null;
  staff: { first_name: string | null; last_name: string | null; preferred_name: string | null } | null;
};

export type LiveBoardRosterRow = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  preferred_name: string | null;
  status: string;
  beds: { rooms: { room_number: string | null } | null } | null;
};

export type LiveBoardEscalationRow = {
  id: string;
  task_id: string;
  resident_id: string;
  escalation_level: number;
  escalation_type: string;
  rung_key: string | null;
  status: string;
  triggered_at: string;
  acknowledged_at: string | null;
};

/** One row per enabled window the cadence in force projects for a service date. */
export type LiveBoardWindowRow = {
  cadence_version_id: string | null;
  window_key: string;
  label: string;
  shift_key: string;
  due_at_utc: string;
  window_opens_at_utc: string;
  window_closes_at_utc: string;
};

/** The facility's shift model. Two rows at every COL building; never assumed. */
export type LiveBoardShiftRow = {
  shift_key: string;
  label: string;
  starts_at_local: string;
  ends_at_local: string;
};

export async function fetchLiveBoardTasks(
  supabase: SupabaseClient,
  facilityId: string,
  fromServiceDate: string,
  toServiceDate: string,
): Promise<LiveBoardTaskRow[]> {
  const { data, error } = await readAllPages((from, to) => supabase
    .from("resident_observation_tasks")
    .select(TASK_SELECT, { count: "exact" })
    .eq("facility_id", facilityId)
    .is("deleted_at", null)
    .gte("service_date", fromServiceDate)
    .lte("service_date", toServiceDate)
    .order("due_at", { ascending: true })
    .order("id").range(from, to));
  if (error) throw error;
  return (data ?? []) as unknown as LiveBoardTaskRow[];
}

/**
 * The facility's active roster. `status = 'active'` is the roster acceptance
 * item 12 compares the board against, and it is also the population the task
 * generator works from, so a mismatch between these two counts is a real
 * finding rather than a definitional argument.
 */
export async function fetchLiveBoardRoster(
  supabase: SupabaseClient,
  facilityId: string,
): Promise<LiveBoardRosterRow[]> {
  const { data, error } = await readAllPages((from, to) => supabase
    .from("residents")
    .select(ROSTER_SELECT, { count: "exact" })
    .eq("facility_id", facilityId)
    .eq("status", "active")
    .is("deleted_at", null)
    .order("last_name", { ascending: true }).order("id").range(from, to));
  if (error) throw error;
  return (data ?? []) as unknown as LiveBoardRosterRow[];
}

/**
 * Open escalations for the board's Escalated filter. An escalation is a state a
 * check is in, not a destination, which is why this read feeds a filter on the
 * board rather than a tab of its own.
 *
 * The nudge rung never lands here: it writes only
 * `observation_escalation_dispatches` and is a staff reminder, not an
 * escalation. Counting it would inflate every escalation number in the module.
 */
export async function fetchLiveBoardEscalations(
  supabase: SupabaseClient,
  facilityId: string,
): Promise<LiveBoardEscalationRow[]> {
  const { data, error } = await readAllPages((from, to) => supabase
    .from("resident_observation_escalations")
    .select(ESCALATION_SELECT, { count: "exact" })
    .eq("facility_id", facilityId)
    .is("deleted_at", null)
    .in("status", ["open", "in_progress"])
    .order("triggered_at", { ascending: false })
    .order("id").range(from, to));
  if (error) throw error;
  return (data ?? []) as unknown as LiveBoardEscalationRow[];
}

/**
 * The windows in force for a service date, read through the projector rather
 * than off `facility_cadence_windows` directly, so the board shows the version
 * that was actually resolved for the date and not whatever configuration is
 * current.
 */
export async function fetchLiveBoardWindows(
  supabase: SupabaseClient,
  facilityId: string,
  serviceDateIso: string,
): Promise<LiveBoardWindowRow[]> {
  const { data, error } = await supabase.rpc("facility_observation_windows_for_date", {
    p_facility_id: facilityId,
    p_service_date: serviceDateIso,
  });
  if (error) throw error;
  return (data ?? []) as unknown as LiveBoardWindowRow[];
}

export async function fetchLiveBoardShifts(
  supabase: SupabaseClient,
  facilityId: string,
): Promise<LiveBoardShiftRow[]> {
  const { data, error } = await supabase
    .from("facility_shift_definitions")
    .select("shift_key, label, starts_at_local, ends_at_local")
    .eq("facility_id", facilityId)
    .eq("active", true)
    .is("deleted_at", null)
    .order("sort_order", { ascending: true });
  if (error) throw error;
  return (data ?? []) as unknown as LiveBoardShiftRow[];
}
