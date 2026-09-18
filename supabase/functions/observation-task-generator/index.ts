/**
 * Observation task generator (spec 25A, Smart Rounding cadence).
 *
 * Cron triggered. Generates one shift ahead, not a fixed number of hours, so a
 * caregiver coming on duty sees every window of their shift at once.
 *
 * This file deliberately contains no observation time, no grace value and no
 * shift boundary. The cadence in force, the shift model and all window
 * arithmetic live in facility configuration and are read through
 * `facility_next_shift_observation_windows`, which resolves them against the
 * facility timezone. Changing a window time is a configuration change here,
 * never a deploy.
 *
 * Every task is stamped with the cadence version that produced it, so a later
 * cadence change cannot rewrite a past compliance number.
 *
 * Monitoring Order suppression is per window, not per resident. A resident under
 * an order loses exactly the standard windows the order's interval covers and
 * keeps the rest, resolved by `observation_windows_under_monitoring_order`, and
 * gets their order tasks from `generate_monitoring_order_tasks` in the same
 * tick, so one cron entry covers both kinds. Asking "is an order in force right
 * now?" once per resident was wrong in both directions: an order starting later
 * today read as not in force and the resident got standard tasks across the
 * order's hours as well as order tasks, and an order ending three hours into a
 * twelve hour shift suppressed the whole shift and left the resident with no
 * task of any kind until the next tick.
 *
 * Every generated task gets an owner the floor can actually be, resolved by
 * `resolve_observation_task_assignees`: the resident split where one exists,
 * otherwise a staff member scheduled for that shift, chosen by a stable hash so
 * a re-run does not reshuffle the board. Where nobody is scheduled no assignee
 * is invented. The tasks are still generated, so the gap is counted rather than
 * hidden, and the shift is raised as a visible defect through
 * `record_observation_staffing_gap` and reported here by facility, shift and
 * service date.
 *
 * The response is a per facility outcome, not a total. A facility that threw, a
 * facility that has no cadence in force and therefore generated nothing, and a
 * facility whose shift has nobody on the schedule are all reported by id and all
 * make `ok` false with a non 200 status. A run that silently logged a per
 * facility exception and still answered `ok: true` told a cron monitor that a
 * building which generated zero tasks was healthy, and a run that generated a
 * full board no caregiver could work would have read the same way.
 *
 * POST body: `{ "organization_id": uuid, "facility_id"?: uuid }`
 * Auth: `x-cron-secret` must equal env `OBSERVATION_TASK_GENERATOR_SECRET`.
 */
import { createClient, type PostgrestError, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { getCorsHeaders, jsonResponse } from "../_shared/cors.ts";
import { withTiming } from "../_shared/structured-log.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * `residents.status` is the `resident_status` enum
 * (`inquiry`, `pending_admission`, `active`, `hospital_hold`, `loa`,
 * `discharged`, `deceased`). The cadence applies to residents who are in the
 * building, which is exactly `active`: the four statuses the spec names as
 * generating nothing are excluded, and so are the two pre-admission statuses,
 * which were never in the building to observe.
 */
const GENERATING_RESIDENT_STATUS = "active";

/** PostgREST codes for a function that does not exist in the schema cache. */
const MISSING_FUNCTION_CODES = new Set(["42883", "PGRST202"]);

interface FacilityRow {
  id: string;
  organization_id: string;
  entity_id: string | null;
}

interface CadenceWindowRow {
  cadence_version_id: string;
  window_key: string;
  label: string;
  shift_key: string;
  roster_shift_type: string;
  shift_service_date: string;
  service_date: string;
  due_at_utc: string;
  window_opens_at_utc: string;
  window_closes_at_utc: string;
  starts_shift: boolean;
}

/**
 * One row of `resolve_observation_task_assignees`. `assignment_source` is the
 * step of the fallback chain that answered, and `none_scheduled` is the one that
 * means nobody on the schedule can work this resident's checks.
 */
interface ResolvedAssigneeRow {
  resident_id: string;
  shift_assignment_id: string | null;
  staff_id: string | null;
  assignment_source: "resident_split" | "shift_roster" | "none_scheduled";
}

/** One row of `observation_windows_under_monitoring_order`. */
interface CoveredWindowRow {
  resident_id: string;
  window_key: string;
  service_date: string;
  monitoring_order_id: string;
}

/**
 * The key a covered window is held under. Deliberately the same three columns as
 * the task table's partial unique index on
 * `(resident_id, window_key, service_date)`, so "suppressed" and "already
 * written" are the same identity and the two cannot drift.
 */
function coverageKey(residentId: string, windowKey: string, serviceDate: string): string {
  return `${residentId}\u0000${windowKey}\u0000${serviceDate}`;
}

/** A shift at a facility on a service date that nobody is scheduled to work. */
interface StaffingGap {
  facility_id: string;
  shift_key: string;
  service_date: string;
  residents_unassigned: number;
}

interface TaskRow {
  organization_id: string;
  entity_id: string | null;
  facility_id: string;
  resident_id: string;
  cadence_version_id: string;
  window_key: string;
  service_date: string;
  shift_assignment_id: string | null;
  assigned_staff_id: string | null;
  scheduled_for: string;
  due_at: string;
  grace_ends_at: string;
  status: string;
}

/**
 * The (resident, window, service date) triples of the shift being generated that
 * an active Monitoring Order covers.
 *
 * The interval arithmetic stays in SQL, next to the window rows and next to the
 * orders, for the same reason the window times do. The grain is the grain of the
 * task table's idempotency index, so this function subtracts one set from the
 * other and does no time comparison of its own.
 *
 * A failure here is not swallowed. An earlier version of this file treated a
 * missing Monitoring Orders table as "no active orders" because the orders
 * migration had not landed yet; that tolerance would now mean writing a full
 * standard board on top of a resident's order tasks, so the facility fails
 * loudly instead.
 */
async function windowsUnderMonitoringOrder(
  admin: SupabaseClient,
  facilityId: string,
  atIso: string,
): Promise<Set<string>> {
  const { data, error } = await admin.rpc("observation_windows_under_monitoring_order", {
    p_facility_id: facilityId,
    p_at: atIso,
  });

  if (error) throw error;

  const covered = new Set<string>();
  for (const row of (data ?? []) as CoveredWindowRow[]) {
    covered.add(coverageKey(row.resident_id, row.window_key, row.service_date));
  }
  return covered;
}

/**
 * Who owns each resident's checks for the shift the windows belong to.
 *
 * The whole fallback chain lives in SQL, in
 * `resolve_observation_task_assignees`, for the same reason the window times do:
 * this file carries no configuration and no scheduling rule of its own, and the
 * chain has to be provable in the same replay that proves the policies. The
 * lookup matches `roster_shift_type`, not `shift_key`: the key is renameable
 * configuration and `shift_assignments.shift_type` is a fixed enum, so joining
 * the two directly would return nothing the moment an administrator renamed a
 * shift, and would read as "nobody was assigned" rather than as an error.
 *
 * Generating one shift ahead means these are always the incoming shift's rows,
 * which is what a shift change window needs: the check is owned by the staff
 * whose shift begins at that time, not by the shift going off duty.
 */
async function assigneesByResident(
  admin: SupabaseClient,
  facilityId: string,
  shiftServiceDate: string,
  rosterShiftType: string,
  residentIds: string[],
): Promise<Map<string, ResolvedAssigneeRow>> {
  const { data, error } = await admin.rpc("resolve_observation_task_assignees", {
    p_facility_id: facilityId,
    p_shift_service_date: shiftServiceDate,
    p_roster_shift_type: rosterShiftType,
    p_resident_ids: residentIds,
  });

  if (error) throw error;

  const byResident = new Map<string, ResolvedAssigneeRow>();
  for (const row of (data ?? []) as ResolvedAssigneeRow[]) {
    byResident.set(row.resident_id, row);
  }
  return byResident;
}

/**
 * Stands down every not yet worked task at this facility that the module would
 * no longer generate.
 *
 * The predicate lives in SQL, in `stand_down_ungenerated_observation_tasks`,
 * because the generator's exclusion and the stand down have to be the same
 * question and they were not. This file used to ask "is there a resident at
 * this facility whose status is not active?", which a transfer does not satisfy:
 * a transferred resident's facility_id points at the new building and their
 * status is still active, so their outstanding tasks stayed live at the building
 * they had left, ran to overdue, climbed the ladder and reached the terminal
 * rung as an SMS and a critical alert naming a room they were not in.
 *
 * Same shape as the hospital_hold defect staging surfaced, where who to exclude
 * and which tasks to stand down were decided by two different predicates. One
 * definition, one place.
 */
async function standDownUngeneratedTasks(
  admin: SupabaseClient,
  facilityId: string,
  atIso: string,
): Promise<number> {
  const { data, error } = await admin.rpc("stand_down_ungenerated_observation_tasks", {
    p_facility_id: facilityId,
    p_at: atIso,
  });

  if (error) throw error;
  return typeof data === "number" ? data : 0;
}

Deno.serve(async (req) => {
  const t = withTiming("observation-task-generator");
  const origin = req.headers.get("origin");

  if (req.method === "OPTIONS") return new Response("ok", { headers: getCorsHeaders(origin) });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405, origin);

  const secret = Deno.env.get("OBSERVATION_TASK_GENERATOR_SECRET");
  const headerSecret = req.headers.get("x-cron-secret");
  if (!secret || headerSecret !== secret) {
    t.log({ event: "auth_failed", outcome: "error", error_message: "secret mismatch" });
    return jsonResponse({ error: "Unauthorized" }, 401, origin);
  }

  let body: { organization_id?: string; facility_id?: string } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    body = {};
  }

  const orgId = body.organization_id;
  if (!orgId || !UUID_RE.test(orgId)) {
    return jsonResponse({ error: "organization_id required" }, 400, origin);
  }
  const scopedFacilityId = body.facility_id;
  if (scopedFacilityId && !UUID_RE.test(scopedFacilityId)) {
    return jsonResponse({ error: "facility_id must be a uuid" }, 400, origin);
  }

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const atIso = new Date().toISOString();

  let facilityQuery = admin
    .from("facilities")
    .select("id, organization_id, entity_id")
    .eq("organization_id", orgId)
    .is("deleted_at", null);
  if (scopedFacilityId) facilityQuery = facilityQuery.eq("id", scopedFacilityId);

  const { data: facilityData, error: facilitiesErr } = await facilityQuery;
  if (facilitiesErr) {
    t.log({ event: "facilities_query_error", outcome: "error", error_message: facilitiesErr.message });
    return jsonResponse({ error: "Query failed" }, 500, origin);
  }

  const facilities = (facilityData ?? []) as FacilityRow[];
  if (facilities.length === 0) {
    // Nothing was asked for and nothing failed. An organization with no
    // facilities is a real, quiet answer; a facility that produced nothing is
    // not, and is reported below.
    t.log({ event: "no_facilities", outcome: "success" });
    return jsonResponse(
      {
        ok: true,
        organization_id: orgId,
        facilities_attempted: 0,
        facilities_succeeded: 0,
        facilities_failed: 0,
        facilities_without_cadence: 0,
        facilities_without_staffing: 0,
        failed_facility_ids: [],
        facility_ids_without_cadence: [],
        facility_ids_without_staffing: [],
        staffing_gaps: [],
        tasks_generated: 0,
        order_tasks_generated: 0,
        tasks_stood_down: 0,
      },
      200,
      origin,
    );
  }

  let tasksGenerated = 0;
  let orderTasksGenerated = 0;
  let tasksStoodDown = 0;
  let facilitiesWithCadence = 0;
  let monitoringOrdersTableMissing = false;
  const failedFacilityIds: string[] = [];
  const facilityIdsWithoutCadence: string[] = [];
  const facilityIdsWithoutStaffing: string[] = [];
  const staffingGaps: StaffingGap[] = [];

  for (const facility of facilities) {
    try {
      const { data: windowData, error: windowsErr } = await admin.rpc("facility_next_shift_observation_windows", {
        p_facility_id: facility.id,
        p_at: atIso,
      });
      if (windowsErr) throw windowsErr;

      const windows = (windowData ?? []) as CadenceWindowRow[];
      if (windows.length === 0) {
        // Not a success. A building with no cadence version in force generates
        // nothing, escalates nothing, and reads as a quiet facility. It is
        // reported by id so a monitor can name the building rather than
        // noticing a total that looks plausible.
        facilityIdsWithoutCadence.push(facility.id);
        t.log({ event: "facility_has_no_cadence", outcome: "error", facility_id: facility.id });
        continue;
      }
      facilitiesWithCadence += 1;

      const { data: residentData, error: residentsErr } = await admin
        .from("residents")
        .select("id")
        .eq("facility_id", facility.id)
        .eq("status", GENERATING_RESIDENT_STATUS)
        .is("deleted_at", null);
      if (residentsErr) throw residentsErr;

      const activeResidentIds = new Set(((residentData ?? []) as { id: string }[]).map((row) => row.id));

      tasksStoodDown += await standDownUngeneratedTasks(admin, facility.id, atIso);

      // Runs before the early return below, because a facility whose whole
      // roster is under orders still has order tasks to write. The horizon and
      // the interval scaled grace live in the SQL function, not here, for the
      // same reason the cadence windows do: this file carries no time and no
      // grace value.
      const { data: orderTasks, error: orderErr } = await admin.rpc("generate_monitoring_order_tasks", {
        p_facility_id: facility.id,
        p_through: null,
      });
      if (orderErr) {
        if (!MISSING_FUNCTION_CODES.has(orderErr.code)) throw orderErr;
        monitoringOrdersTableMissing = true;
      }
      orderTasksGenerated += typeof orderTasks === "number" ? orderTasks : 0;

      const covered = await windowsUnderMonitoringOrder(admin, facility.id, atIso);

      const residentIds = [...activeResidentIds];
      if (residentIds.length === 0) continue;

      // Every resident is still considered for every window. What an order
      // takes away is the individual windows it covers, so a resident whose
      // order starts at midday keeps that morning's checks and a resident whose
      // order ends at midday keeps that evening's.
      const rows: TaskRow[] = [];
      const residentsWithWork = new Set<string>();
      for (const window of windows) {
        for (const residentId of residentIds) {
          if (covered.has(coverageKey(residentId, window.window_key, window.service_date))) continue;
          residentsWithWork.add(residentId);
          rows.push({
            organization_id: facility.organization_id,
            entity_id: facility.entity_id,
            facility_id: facility.id,
            resident_id: residentId,
            cadence_version_id: window.cadence_version_id,
            window_key: window.window_key,
            service_date: window.service_date,
            shift_assignment_id: null,
            assigned_staff_id: null,
            scheduled_for: window.window_opens_at_utc,
            due_at: window.due_at_utc,
            grace_ends_at: window.window_closes_at_utc,
            status: "upcoming",
          });
        }
      }

      // A facility whose every resident is fully covered by an order has no
      // standard window to write and no staffing gap to report: their order
      // tasks went out above.
      if (rows.length === 0) continue;

      const firstWindow = windows[0];
      const assignees = await assigneesByResident(
        admin,
        facility.id,
        firstWindow.shift_service_date,
        firstWindow.roster_shift_type,
        [...residentsWithWork],
      );

      for (const row of rows) {
        const assignee = assignees.get(row.resident_id) ?? null;
        row.shift_assignment_id = assignee?.shift_assignment_id ?? null;
        row.assigned_staff_id = assignee?.staff_id ?? null;
      }

      // Nobody on the schedule for this shift. The tasks below are still
      // written, because a resident nobody was rostered for is still a resident
      // who has to be looked at, and a board that quietly shrinks hides the
      // staffing gap instead of showing it. What must not happen is inventing an
      // assignee: a task assigned to somebody who is not working is worse than a
      // task nobody is assigned, because the first one looks covered.
      const unassigned = [...residentsWithWork].filter((residentId) => !assignees.get(residentId)?.staff_id);
      if (unassigned.length > 0) {
        facilityIdsWithoutStaffing.push(facility.id);
        staffingGaps.push({
          facility_id: facility.id,
          shift_key: firstWindow.shift_key,
          service_date: firstWindow.shift_service_date,
          residents_unassigned: unassigned.length,
        });
        t.log({
          event: "facility_shift_has_no_scheduled_staff",
          outcome: "error",
          facility_id: facility.id,
          shift_key: firstWindow.shift_key,
          service_date: firstWindow.shift_service_date,
          residents_unassigned: unassigned.length,
        });
        const { error: gapErr } = await admin.rpc("record_observation_staffing_gap", {
          p_facility_id: facility.id,
          p_shift_key: firstWindow.shift_key,
          p_service_date: firstWindow.shift_service_date,
        });
        // The alert is how a human sees the gap; it is not how the gap is
        // counted. A failure to record it must not swallow the generation this
        // facility still owes, so it is logged and the run continues.
        if (gapErr) {
          t.log({
            event: "staffing_gap_alert_failed",
            outcome: "error",
            facility_id: facility.id,
            error_code: gapErr.code,
            error_message: gapErr.message,
          });
        }
      }

      const { data: inserted, error: writeErr } = await admin.rpc("record_cadence_observation_tasks", {
        p_rows: rows,
      });
      if (writeErr) throw writeErr;

      tasksGenerated += typeof inserted === "number" ? inserted : 0;
    } catch (caught) {
      const error = caught as PostgrestError;
      failedFacilityIds.push(facility.id);
      t.log({
        event: "facility_generation_error",
        outcome: "error",
        facility_id: facility.id,
        error_code: error.code,
        error_message: error.message,
      });
    }
  }

  const facilitiesAttempted = facilities.length;
  const facilitiesFailed = failedFacilityIds.length;
  const facilitiesWithoutCadence = facilityIdsWithoutCadence.length;
  const facilitiesWithoutStaffing = facilityIdsWithoutStaffing.length;
  const facilitiesSucceeded = facilitiesAttempted - facilitiesFailed - facilitiesWithoutCadence;
  const allFacilitiesProduced = facilitiesFailed === 0
    && facilitiesWithoutCadence === 0
    && facilitiesWithoutStaffing === 0;

  t.log({
    event: "complete",
    outcome: allFacilitiesProduced ? "success" : "error",
    facilities: facilitiesAttempted,
    facilities_succeeded: facilitiesSucceeded,
    facilities_failed: facilitiesFailed,
    facilities_without_cadence: facilitiesWithoutCadence,
    facilities_without_staffing: facilitiesWithoutStaffing,
    facilities_with_cadence: facilitiesWithCadence,
    tasks_generated: tasksGenerated,
    order_tasks_generated: orderTasksGenerated,
    tasks_stood_down: tasksStoodDown,
    monitoring_orders_table_missing: monitoringOrdersTableMissing,
  });

  return jsonResponse(
    {
      ok: allFacilitiesProduced,
      organization_id: orgId,
      facilities_attempted: facilitiesAttempted,
      facilities_succeeded: facilitiesSucceeded,
      facilities_failed: facilitiesFailed,
      facilities_without_cadence: facilitiesWithoutCadence,
      facilities_without_staffing: facilitiesWithoutStaffing,
      failed_facility_ids: failedFacilityIds,
      facility_ids_without_cadence: facilityIdsWithoutCadence,
      facility_ids_without_staffing: facilityIdsWithoutStaffing,
      staffing_gaps: staffingGaps,
      tasks_generated: tasksGenerated,
      order_tasks_generated: orderTasksGenerated,
      tasks_stood_down: tasksStoodDown,
    },
    // 207 rather than 500: some buildings did generate, and a monitor that
    // retries a 500 would regenerate for them. `ok` is the field to alert on.
    allFacilitiesProduced ? 200 : 207,
    origin,
  );
});
