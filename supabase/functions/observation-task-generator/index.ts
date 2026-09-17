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

/** Task statuses that have not been worked yet and may still be stood down. */
const NOT_YET_WORKED_STATUSES = ["upcoming", "due_soon"];

const STOOD_DOWN_REASON = "Resident is no longer active at this facility";

/** PostgREST codes for a relation that does not exist in the schema cache. */
const MISSING_RELATION_CODES = new Set(["42P01", "PGRST205"]);

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

interface ShiftAssignmentRow {
  id: string;
  staff_id: string;
  assigned_resident_ids: string[] | null;
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
 * Residents under an active Monitoring Order keep order tasks instead of the
 * standard windows. The Monitoring Orders migration owns that table and may not
 * have landed yet, so a missing relation reads as "no active orders" and this
 * function behaves correctly before and after it lands.
 */
async function residentsUnderMonitoringOrder(
  admin: SupabaseClient,
  facilityId: string,
  atIso: string,
): Promise<{ residentIds: Set<string>; tableMissing: boolean }> {
  const { data, error } = await admin
    .from("resident_monitoring_orders")
    .select("resident_id")
    .eq("facility_id", facilityId)
    .eq("status", "active")
    .is("deleted_at", null)
    .lte("starts_at", atIso)
    .or(`ends_at.is.null,ends_at.gt.${atIso}`);

  if (error) {
    if (MISSING_RELATION_CODES.has(error.code)) return { residentIds: new Set(), tableMissing: true };
    throw error;
  }

  const rows = (data ?? []) as { resident_id: string }[];
  return { residentIds: new Set(rows.map((row) => row.resident_id)), tableMissing: false };
}

/**
 * Shift assignments for the shift the windows belong to. The lookup matches
 * `roster_shift_type`, not `shift_key`: the key is renameable configuration and
 * `shift_assignments.shift_type` is a fixed enum, so joining the two directly
 * would return nothing the moment an administrator renamed a shift, and would
 * read as "nobody was assigned" rather than as an error. Generating one shift
 * ahead means these are always the incoming shift's rows, which is what a shift
 * change window needs: the check is owned by the staff whose shift begins at
 * that time, not by the shift going off duty. Where no incoming row covers a
 * resident the task is left unassigned, which is the facility pool.
 */
async function assignmentsByResident(
  admin: SupabaseClient,
  organizationId: string,
  facilityId: string,
  shiftServiceDate: string,
  rosterShiftType: string,
): Promise<Map<string, ShiftAssignmentRow>> {
  const { data, error } = await admin
    .from("shift_assignments")
    .select("id, staff_id, assigned_resident_ids")
    .eq("organization_id", organizationId)
    .eq("facility_id", facilityId)
    .eq("shift_date", shiftServiceDate)
    .eq("shift_type", rosterShiftType)
    .in("status", ["assigned", "confirmed"])
    .is("deleted_at", null);

  if (error) throw error;

  const byResident = new Map<string, ShiftAssignmentRow>();
  for (const row of (data ?? []) as ShiftAssignmentRow[]) {
    for (const residentId of row.assigned_resident_ids ?? []) {
      if (!byResident.has(residentId)) byResident.set(residentId, row);
    }
  }
  return byResident;
}

/**
 * A resident whose status moved away from active mid shift keeps tasks that
 * would otherwise run to overdue and land on the escalation ladder for someone
 * who is not in the building. Stand them down instead of leaving them to miss.
 */
async function standDownTasksForDepartedResidents(
  admin: SupabaseClient,
  facilityId: string,
  activeResidentIds: Set<string>,
  atIso: string,
): Promise<number> {
  const { data: departed, error: residentsErr } = await admin
    .from("residents")
    .select("id")
    .eq("facility_id", facilityId)
    .neq("status", GENERATING_RESIDENT_STATUS)
    .is("deleted_at", null);

  if (residentsErr) throw residentsErr;

  const departedIds = ((departed ?? []) as { id: string }[])
    .map((row) => row.id)
    .filter((id) => !activeResidentIds.has(id));
  if (departedIds.length === 0) return 0;

  const { data, error } = await admin
    .from("resident_observation_tasks")
    .update({ status: "excused", excused_reason: STOOD_DOWN_REASON })
    .eq("facility_id", facilityId)
    .in("resident_id", departedIds)
    .in("status", NOT_YET_WORKED_STATUSES)
    .gt("due_at", atIso)
    .is("deleted_at", null)
    .select("id");

  if (error) throw error;
  return (data ?? []).length;
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
    t.log({ event: "no_facilities", outcome: "success" });
    return jsonResponse({ ok: true, organization_id: orgId, tasks_generated: 0 }, 200, origin);
  }

  let tasksGenerated = 0;
  let tasksStoodDown = 0;
  let facilitiesWithCadence = 0;
  let monitoringOrdersTableMissing = false;

  for (const facility of facilities) {
    try {
      const { data: windowData, error: windowsErr } = await admin.rpc("facility_next_shift_observation_windows", {
        p_facility_id: facility.id,
        p_at: atIso,
      });
      if (windowsErr) throw windowsErr;

      const windows = (windowData ?? []) as CadenceWindowRow[];
      if (windows.length === 0) {
        t.log({ event: "facility_has_no_cadence", outcome: "success", facility_id: facility.id });
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

      tasksStoodDown += await standDownTasksForDepartedResidents(admin, facility.id, activeResidentIds, atIso);

      const monitored = await residentsUnderMonitoringOrder(admin, facility.id, atIso);
      monitoringOrdersTableMissing = monitoringOrdersTableMissing || monitored.tableMissing;

      const residentIds = [...activeResidentIds].filter((id) => !monitored.residentIds.has(id));
      if (residentIds.length === 0) continue;

      const firstWindow = windows[0];
      const assignments = await assignmentsByResident(
        admin,
        facility.organization_id,
        facility.id,
        firstWindow.shift_service_date,
        firstWindow.roster_shift_type,
      );

      const rows: TaskRow[] = [];
      for (const window of windows) {
        for (const residentId of residentIds) {
          const assignment = assignments.get(residentId) ?? null;
          rows.push({
            organization_id: facility.organization_id,
            entity_id: facility.entity_id,
            facility_id: facility.id,
            resident_id: residentId,
            cadence_version_id: window.cadence_version_id,
            window_key: window.window_key,
            service_date: window.service_date,
            shift_assignment_id: assignment?.id ?? null,
            assigned_staff_id: assignment?.staff_id ?? null,
            scheduled_for: window.window_opens_at_utc,
            due_at: window.due_at_utc,
            grace_ends_at: window.window_closes_at_utc,
            status: "upcoming",
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
      t.log({
        event: "facility_generation_error",
        outcome: "error",
        facility_id: facility.id,
        error_code: error.code,
        error_message: error.message,
      });
    }
  }

  t.log({
    event: "complete",
    outcome: "success",
    facilities: facilities.length,
    facilities_with_cadence: facilitiesWithCadence,
    tasks_generated: tasksGenerated,
    tasks_stood_down: tasksStoodDown,
    monitoring_orders_table_missing: monitoringOrdersTableMissing,
  });

  return jsonResponse(
    {
      ok: true,
      organization_id: orgId,
      facilities: facilities.length,
      tasks_generated: tasksGenerated,
      tasks_stood_down: tasksStoodDown,
    },
    200,
    origin,
  );
});
