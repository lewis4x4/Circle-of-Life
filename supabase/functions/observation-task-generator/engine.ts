/**
 * Observation task generator run (spec 25A; see index.ts for the contract).
 *
 * Everything the cron tick decides lives here, separate from the HTTP handler,
 * so the per facility outcome can be tested against a fake client without a
 * network or an environment.
 */
import type { PostgrestError, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

export interface GeneratorLogger {
  log(entry: Record<string, unknown>): void;
}

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
 * means nobody on the schedule or on the clock can work this resident's checks.
 * `awaiting_clock_in` is the next shift at a building that staffs from punches,
 * or the shift in progress during its handoff grace while nobody has clocked in
 * for it: the checks are written unowned and `assign_unowned_observation_tasks`
 * gives them owners once the relief clocks in (or, after the grace, to whoever
 * is on the clock). It is not a staffing gap.
 */
interface ResolvedAssigneeRow {
  resident_id: string;
  shift_assignment_id: string | null;
  staff_id: string | null;
  assignment_source: "resident_split" | "shift_roster" | "on_clock" | "awaiting_clock_in" | "none_scheduled";
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

/** Resolve each resident's owner at this task's actual due instant. Clinical
 * cadence still defines every window; published work intervals choose owners. */
async function assigneesByResident(
  admin: SupabaseClient,
  facilityId: string,
  dueAt: string,
  residentIds: string[],
): Promise<Map<string, ResolvedAssigneeRow>> {
  const { data, error } = await admin.rpc("resolve_observation_task_assignees_for_instant", {
    p_facility_id: facilityId,
    p_at: dueAt,
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

/**
 * Gives every still-unowned, not yet due check of the shift in progress an
 * owner, through the same chain `resolve_observation_task_assignees` uses: in
 * practice the staff on the clock when nobody is scheduled (COL-693). Checks
 * that already have an owner are never touched, so a re-run assigns nothing.
 * The owner decision, the "not yet due" rule and the shift bounds all live in
 * SQL, for the same reason the window times do.
 */
async function assignUnownedTasks(
  admin: SupabaseClient,
  facilityId: string,
  atIso: string,
): Promise<number> {
  const { data, error } = await admin.rpc("assign_unowned_observation_tasks", {
    p_facility_id: facilityId,
    p_at: atIso,
  });

  if (error) throw error;
  return typeof data === "number" ? data : 0;
}

export interface GeneratorSummary {
  ok: boolean;
  facilities_attempted: number;
  facilities_succeeded: number;
  facilities_failed: number;
  facilities_without_cadence: number;
  facilities_without_staffing: number;
  failed_facility_ids: string[];
  facility_ids_without_cadence: string[];
  facility_ids_without_staffing: string[];
  staffing_gaps: StaffingGap[];
  tasks_generated: number;
  order_tasks_generated: number;
  tasks_stood_down: number;
  tasks_assigned_on_clock: number;
  staffing_gaps_resolved: number;
}

/** The facilities query failed; the handler answers 500 rather than a summary. */
export class FacilitiesQueryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FacilitiesQueryError";
  }
}

export async function runObservationTaskGenerator(options: {
  admin: SupabaseClient;
  organizationId: string;
  facilityId: string | null;
  atIso: string;
  log: GeneratorLogger;
}): Promise<GeneratorSummary> {
  const { admin, atIso } = options;
  const t = options.log;

  let facilityQuery = admin
    .from("facilities")
    .select("id, organization_id, entity_id")
    .eq("organization_id", options.organizationId)
    .is("deleted_at", null);
  if (options.facilityId) facilityQuery = facilityQuery.eq("id", options.facilityId);

  const { data: facilityData, error: facilitiesErr } = await facilityQuery;
  if (facilitiesErr) {
    t.log({ event: "facilities_query_error", outcome: "error", error_message: facilitiesErr.message });
    throw new FacilitiesQueryError(facilitiesErr.message);
  }

  const facilities = (facilityData ?? []) as FacilityRow[];
  if (facilities.length === 0) {
    // Nothing was asked for and nothing failed. An organization with no
    // facilities is a real, quiet answer; a facility that produced nothing is
    // not, and is reported below.
    t.log({ event: "no_facilities", outcome: "success" });
    return {
      ok: true,
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
      tasks_assigned_on_clock: 0,
      staffing_gaps_resolved: 0,
    };
  }

  let tasksGenerated = 0;
  let orderTasksGenerated = 0;
  let tasksStoodDown = 0;
  let tasksAssignedOnClock = 0;
  let staffingGapsResolved = 0;
  let facilitiesWithCadence = 0;
  let monitoringOrdersTableMissing = false;
  const failedFacilityIds: string[] = [];
  const facilityIdsWithoutCadence: string[] = [];
  const facilityIdsWithoutStaffing: string[] = [];
  const staffingGaps: StaffingGap[] = [];

  for (const facility of facilities) {
    try {
      const { data: windowData, error: windowsErr } = await admin.rpc("facility_current_and_next_shift_observation_windows", {
        p_facility_id: facility.id,
        p_at: atIso,
      });
      if (windowsErr) throw windowsErr;

      tasksStoodDown += await standDownUngeneratedTasks(admin, facility.id, atIso);

      // Orders and transferred-resident stand-down also run when cadence
      // windows are absent. A standard-cadence gap must not stop a clinical order. The horizon and
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

      const projectedWindows = (windowData ?? []) as CadenceWindowRow[];
      if (projectedWindows.length === 0) {
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

      const covered = await windowsUnderMonitoringOrder(admin, facility.id, atIso);

      const residentIds = [...activeResidentIds];
      if (residentIds.length === 0) continue;

      // Every resident is still considered for every window. What an order
      // takes away is the individual windows it covers, so a resident whose
      // order starts at midday keeps that morning's checks and a resident whose
      // order ends at midday keeps that evening's.
      // Assignment is shift-specific: a repaired current shift must never inherit
      // the staff roster of the following shift.
      const shiftWindows = new Map<string, CadenceWindowRow[]>();
      const staffedShiftsToResolve: CadenceWindowRow[] = [];
      for (const window of projectedWindows) {
        const key = `${window.shift_key}:${window.shift_service_date}`;
        shiftWindows.set(key, [...(shiftWindows.get(key) ?? []), window]);
      }
      for (const windows of shiftWindows.values()) {
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
        const assignees = new Map<string, ResolvedAssigneeRow>();
        for (const dueAt of new Set(rows.map((row) => row.due_at))) {
          const residentsAtDue = [...new Set(rows.filter((row) => row.due_at === dueAt).map((row) => row.resident_id))];
          const atDue = await assigneesByResident(admin, facility.id, dueAt, residentsAtDue);
          for (const [residentId, resolved] of atDue) assignees.set(`${dueAt}:${residentId}`, resolved);
        }
        for (const row of rows) {
          const assignee = assignees.get(`${row.due_at}:${row.resident_id}`) ?? null;
          row.shift_assignment_id = assignee?.shift_assignment_id ?? null;
          row.assigned_staff_id = assignee?.staff_id ?? null;
        }

        // Nobody on the schedule for this shift. The tasks below are still
        // written, because a resident nobody was rostered for is still a resident
        // who has to be looked at, and a board that quietly shrinks hides the
        // staffing gap instead of showing it. What must not happen is inventing an
        // assignee: a task assigned to somebody who is not working is worse than a
        // task nobody is assigned, because the first one looks covered.
        //
        // `awaiting_clock_in` is excluded: the next shift, or the shift in
        // progress inside its handoff grace, at a building that staffs from
        // punches. Its owners come from the clock. Counting it would report
        // every such building as unstaffed on every tick.
        const unassigned = [...new Set(rows.filter((row) => {
          const assignee = assignees.get(`${row.due_at}:${row.resident_id}`);
          return !assignee?.staff_id && assignee?.assignment_source !== "awaiting_clock_in";
        }).map((row) => row.resident_id))];
        if (unassigned.length > 0) {
          if (!facilityIdsWithoutStaffing.includes(facility.id)) facilityIdsWithoutStaffing.push(facility.id);
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
        } else if ([...assignees.values()].some((assignee) => assignee.assignment_source === "on_clock")) {
          // Closing the alert records that ownership repair succeeded. Defer it
          // until every cadence write and the unowned assignment pass finish.
          staffedShiftsToResolve.push(firstWindow);
        }

        const { data: inserted, error: writeErr } = await admin.rpc("record_cadence_observation_tasks", {
          p_rows: rows,
        });
        if (writeErr) throw writeErr;

        tasksGenerated += typeof inserted === "number" ? inserted : 0;
      }

      // After the writes: checks written unowned on an earlier tick (the
      // incoming shift, before anybody could be on the clock for it) get their
      // owner now that the shift is in progress. A building with no cadence or
      // no residents returned above; it has no shift in force or no checks, so
      // there is nothing for this pass to own.
      tasksAssignedOnClock += await assignUnownedTasks(admin, facility.id, atIso);

      // Only a facility whose writes and ownership repair succeeded may resolve
      // its staffing alerts. SQL rechecks whether each shift is still staffed.
      // A failed alert resolution is logged without undoing completed generation.
      for (const shift of staffedShiftsToResolve) {
        const { data: resolved, error: resolveErr } = await admin.rpc("resolve_observation_staffing_gap", {
          p_facility_id: facility.id,
          p_shift_key: shift.shift_key,
          p_service_date: shift.shift_service_date,
        });
        if (resolveErr) {
          t.log({
            event: "staffing_gap_resolve_failed",
            outcome: "error",
            facility_id: facility.id,
            error_code: resolveErr.code,
            error_message: resolveErr.message,
          });
        } else if (resolved === true) {
          staffingGapsResolved += 1;
        }
      }
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
    tasks_assigned_on_clock: tasksAssignedOnClock,
    staffing_gaps_resolved: staffingGapsResolved,
    monitoring_orders_table_missing: monitoringOrdersTableMissing,
  });

  return {
    ok: allFacilitiesProduced,
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
    tasks_assigned_on_clock: tasksAssignedOnClock,
    staffing_gaps_resolved: staffingGapsResolved,
  };
}
