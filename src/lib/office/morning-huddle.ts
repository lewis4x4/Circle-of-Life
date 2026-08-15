import type { SupabaseClient } from "@supabase/supabase-js";

import {
  formatMorningHuddleResidentName,
  formatMorningHuddleStaffName,
} from "@/lib/office/morning-huddle-display-copy";
import type { Database } from "@/types/database";

/** Calendar day in America/New_York as YYYY-MM-DD (foundation spec: COL facilities anchor to ET). */
export function huddleTodayEtIso(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

export type HuddleIncident = {
  id: string;
  incidentNumber: string;
  category: string;
  severity: string;
  status: string;
  occurredAt: string;
  residentName: string | null;
  ahcaReportable: boolean;
};

export type HuddleShiftRow = {
  id: string;
  staffName: string;
  shiftType: string;
  status: string;
};

export type HuddleOceTask = {
  id: string;
  templateName: string;
  templateCategory: string;
  priority: string;
  status: string;
  assignedShift: string | null;
  assignedShiftDate: string;
  licenseThreatening: boolean;
};

export type HuddleMedFlag = {
  id: string;
  residentName: string;
  status: string;
  scheduledTime: string;
  reason: string | null;
};

export type HuddleResidentMove = {
  id: string;
  residentName: string;
  kind: "move_in" | "move_out" | "planned_move_out";
  date: string;
};

export type MorningHuddleData = {
  facilityId: string;
  dateIso: string;
  generatedAt: string;
  census: number;
  overnightIncidents: HuddleIncident[];
  shiftRoster: HuddleShiftRow[];
  openOceTasks: HuddleOceTask[];
  medFlags: HuddleMedFlag[];
  overdueScheduledDoses: number;
  residentMoves: HuddleResidentMove[];
};

type QueryError = { message: string };
type QueryResult<T> = { data: T[] | null; error: QueryError | null };

type IncidentRow = {
  id: string;
  incident_number: string;
  category: string;
  severity: string;
  status: string;
  occurred_at: string;
  ahca_reportable: boolean;
  residents: { first_name: string; last_name: string } | null;
};

type ShiftAssignmentRow = {
  id: string;
  shift_type: string;
  status: string;
  staff: { first_name: string; last_name: string } | null;
};

type OceTaskRow = {
  id: string;
  template_name: string;
  template_category: string;
  priority: string;
  status: string;
  assigned_shift: string | null;
  assigned_shift_date: string;
  license_threatening: boolean;
};

type EmarFlagRow = {
  id: string;
  status: string;
  scheduled_time: string;
  refusal_reason: string | null;
  hold_reason: string | null;
  not_available_reason: string | null;
  residents: { first_name: string; last_name: string } | null;
};

type ResidentMoveRow = {
  id: string;
  first_name: string;
  last_name: string;
  admission_date: string | null;
  discharge_date: string | null;
  discharge_target_date: string | null;
};

/**
 * Aggregates the per-facility morning briefing from existing tables through the
 * caller's session client — RLS on each source table governs visibility.
 * "Overnight" = the 24 hours ending now.
 */
export async function fetchMorningHuddleData(
  supabase: SupabaseClient<Database>,
  facilityId: string,
  dateIso: string,
): Promise<MorningHuddleData> {
  const now = new Date();
  const windowStartIso = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();

  const incidentsQ = supabase
    .from("incidents")
    .select(
      "id, incident_number, category, severity, status, occurred_at, ahca_reportable, residents(first_name, last_name)",
    )
    .eq("facility_id", facilityId)
    .is("deleted_at", null)
    .gte("occurred_at", windowStartIso)
    .order("occurred_at", { ascending: false })
    .limit(50);

  const rosterQ = supabase
    .from("shift_assignments")
    .select("id, shift_type, status, staff(first_name, last_name)")
    .eq("facility_id", facilityId)
    .eq("shift_date", dateIso)
    .is("deleted_at", null)
    .order("shift_type", { ascending: true })
    .limit(200);

  const oceQ = supabase
    .from("operation_task_instances" as never)
    .select(
      "id, template_name, template_category, priority, status, assigned_shift, assigned_shift_date, license_threatening",
    )
    .eq("facility_id", facilityId)
    .is("deleted_at", null)
    .lte("assigned_shift_date", dateIso)
    .in("status", ["pending", "in_progress", "missed"])
    .order("assigned_shift_date", { ascending: true })
    .limit(100);

  const medFlagsQ = supabase
    .from("emar_records")
    .select(
      "id, status, scheduled_time, refusal_reason, hold_reason, not_available_reason, residents(first_name, last_name)",
    )
    .eq("facility_id", facilityId)
    .is("deleted_at", null)
    .gte("scheduled_time", windowStartIso)
    .in("status", ["refused", "held", "not_available"])
    .order("scheduled_time", { ascending: false })
    .limit(50);

  const overdueQ = supabase
    .from("emar_records")
    .select("id", { count: "exact", head: true })
    .eq("facility_id", facilityId)
    .is("deleted_at", null)
    .eq("status", "scheduled")
    .lt("scheduled_time", now.toISOString());

  const censusQ = supabase
    .from("residents")
    .select("id", { count: "exact", head: true })
    .eq("facility_id", facilityId)
    .is("deleted_at", null)
    .is("discharge_date", null);

  const movesQ = supabase
    .from("residents")
    .select("id, first_name, last_name, admission_date, discharge_date, discharge_target_date")
    .eq("facility_id", facilityId)
    .is("deleted_at", null)
    .or(
      `admission_date.eq.${dateIso},discharge_date.eq.${dateIso},discharge_target_date.eq.${dateIso}`,
    )
    .limit(50);

  const [incidentsRes, rosterRes, oceRes, medFlagsRes, overdueRes, censusRes, movesRes] =
    await Promise.all([
      incidentsQ as unknown as Promise<QueryResult<IncidentRow>>,
      rosterQ as unknown as Promise<QueryResult<ShiftAssignmentRow>>,
      oceQ as unknown as Promise<QueryResult<OceTaskRow>>,
      medFlagsQ as unknown as Promise<QueryResult<EmarFlagRow>>,
      overdueQ as unknown as Promise<{ count: number | null; error: QueryError | null }>,
      censusQ as unknown as Promise<{ count: number | null; error: QueryError | null }>,
      movesQ as unknown as Promise<QueryResult<ResidentMoveRow>>,
    ]);

  for (const res of [incidentsRes, rosterRes, oceRes, medFlagsRes, movesRes]) {
    if (res.error) throw new Error(res.error.message);
  }
  if (overdueRes.error) throw new Error(overdueRes.error.message);
  if (censusRes.error) throw new Error(censusRes.error.message);

  const residentMoves: HuddleResidentMove[] = [];
  for (const r of movesRes.data ?? []) {
    const name = formatMorningHuddleResidentName(r);
    if (r.admission_date === dateIso) {
      residentMoves.push({ id: `${r.id}-in`, residentName: name, kind: "move_in", date: dateIso });
    }
    if (r.discharge_date === dateIso) {
      residentMoves.push({ id: `${r.id}-out`, residentName: name, kind: "move_out", date: dateIso });
    } else if (r.discharge_target_date === dateIso) {
      residentMoves.push({
        id: `${r.id}-planned`,
        residentName: name,
        kind: "planned_move_out",
        date: dateIso,
      });
    }
  }

  return {
    facilityId,
    dateIso,
    generatedAt: now.toISOString(),
    census: censusRes.count ?? 0,
    overnightIncidents: (incidentsRes.data ?? []).map((r) => ({
      id: r.id,
      incidentNumber: r.incident_number,
      category: r.category,
      severity: r.severity,
      status: r.status,
      occurredAt: r.occurred_at,
      residentName: r.residents ? formatMorningHuddleResidentName(r.residents) : null,
      ahcaReportable: r.ahca_reportable,
    })),
    shiftRoster: (rosterRes.data ?? []).map((r) => ({
      id: r.id,
      staffName: formatMorningHuddleStaffName(r.staff),
      shiftType: r.shift_type,
      status: r.status,
    })),
    openOceTasks: (oceRes.data ?? []).map((r) => ({
      id: r.id,
      templateName: r.template_name,
      templateCategory: r.template_category,
      priority: r.priority,
      status: r.status,
      assignedShift: r.assigned_shift,
      assignedShiftDate: r.assigned_shift_date,
      licenseThreatening: r.license_threatening,
    })),
    medFlags: (medFlagsRes.data ?? []).map((r) => ({
      id: r.id,
      residentName: formatMorningHuddleResidentName(r.residents),
      status: r.status,
      scheduledTime: r.scheduled_time,
      reason: r.refusal_reason ?? r.hold_reason ?? r.not_available_reason,
    })),
    overdueScheduledDoses: overdueRes.count ?? 0,
    residentMoves,
  };
}
