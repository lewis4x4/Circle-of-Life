import type { SupabaseClient } from "@supabase/supabase-js";

import {
  classifyFollowupEscalation,
  type FollowupEscalationLevel,
} from "@/lib/incidents/followup-escalation";
import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import type { Database } from "@/types/database";

export type IncidentSeverityUi = "level_1" | "level_2" | "level_3" | "level_4";
export type IncidentStatusUi = "open" | "in_review" | "closed";
export type IncidentCategoryUi = "fall" | "medication_error" | "behavioral" | "elopement" | "other";
export type RcaInvestigationUi = "none" | "draft" | "complete";

export type SupabaseIncidentDetail = {
  id: string;
  facility_id: string;
  resident_id: string | null;
  incident_number: string;
  category: string;
  severity: string;
  status: string;
  occurred_at: string;
  discovered_at: string;
  shift: string;
  location_description: string;
  location_type: string | null;
  description: string;
  immediate_actions: string;
  contributing_factors: string[] | null;
  injury_occurred: boolean;
  injury_description: string | null;
  injury_severity: string | null;
  injury_body_location: string | null;
  fall_witnessed: boolean | null;
  fall_type: string | null;
  fall_activity: string | null;
  reported_by: string;
  witness_names: string[] | null;
  nurse_notified: boolean;
  nurse_notified_at: string | null;
  administrator_notified: boolean;
  administrator_notified_at: string | null;
  owner_notified: boolean;
  owner_notified_at: string | null;
  physician_notified: boolean;
  physician_notified_at: string | null;
  family_notified: boolean;
  family_notified_at: string | null;
  ahca_reportable: boolean;
  ahca_reported: boolean;
  ahca_reported_at: string | null;
  insurance_reportable: boolean;
  insurance_reported: boolean;
  insurance_reported_at: string | null;
  resolved_at: string | null;
  resolution_notes: string | null;
  care_plan_updated: boolean;
  care_plan_update_notes: string | null;
  updated_at: string | null;
};

export type IncidentWatchInstance = {
  id: string;
  status: string;
  starts_at: string;
  ends_at: string | null;
  triggered_by_type: string;
  triggered_by_id: string | null;
  resident_watch_protocols?: { name: string } | null;
  taskSummary: {
    total: number;
    open: number;
    overdue: number;
    missed: number;
  };
  events: Array<{
    id: string;
    event_type: string;
    occurred_at: string;
    note: string | null;
  }>;
};

export type IncidentAssuranceEscalation = {
  id: string;
  task_id: string;
  escalation_level: number;
  escalation_type: string;
  status: string;
  triggered_at: string;
  resolution_note: string | null;
  task_status: string;
  task_due_at: string;
};

export type IncidentDetailView = {
  incident: SupabaseIncidentDetail;
  residentName: string | null;
  reporterName: string;
  categoryUi: IncidentCategoryUi;
  severityUi: IncidentSeverityUi;
  statusUi: IncidentStatusUi;
  rcaInvestigation: RcaInvestigationUi;
  followups: Array<{
    id: string;
    taskType: string;
    description: string;
    dueLabel: string;
    statusLabel: string;
    assignedToId: string | null;
    assignee: string;
    isCompleted: boolean;
    isOverdue: boolean;
    hoursOverdue: number;
    escalationLevel: FollowupEscalationLevel;
  }>;
  watchInstances: IncidentWatchInstance[];
  assuranceEscalations: IncidentAssuranceEscalation[];
};

type SupabaseFollowup = {
  id: string;
  task_type: string;
  description: string;
  due_at: string;
  completed_at: string | null;
  assigned_to: string | null;
};

type SupabaseResidentMini = {
  id: string;
  first_name: string | null;
  last_name: string | null;
};

type SupabaseProfileMini = {
  id: string;
  full_name: string | null;
};

type SupabaseObservationEscalation = {
  id: string;
  task_id: string;
  escalation_level: number;
  escalation_type: string;
  status: string;
  triggered_at: string;
  resolution_note: string | null;
  deleted_at: string | null;
};

type SupabaseObservationTask = {
  id: string;
  watch_instance_id: string | null;
  status: string;
  due_at: string;
  resident_observation_escalations?: SupabaseObservationEscalation[] | null;
};

type QueryError = { message: string };
type QueryResult<T> = { data: T | null; error: QueryError | null };
type QueryListResult<T> = { data: T[] | null; error: QueryError | null };

const INCIDENT_COLUMNS = [
  "id",
  "facility_id",
  "resident_id",
  "incident_number",
  "category",
  "severity",
  "status",
  "occurred_at",
  "discovered_at",
  "shift",
  "location_description",
  "location_type",
  "description",
  "immediate_actions",
  "contributing_factors",
  "injury_occurred",
  "injury_description",
  "injury_severity",
  "injury_body_location",
  "fall_witnessed",
  "fall_type",
  "fall_activity",
  "reported_by",
  "witness_names",
  "nurse_notified",
  "nurse_notified_at",
  "administrator_notified",
  "administrator_notified_at",
  "owner_notified",
  "owner_notified_at",
  "physician_notified",
  "physician_notified_at",
  "family_notified",
  "family_notified_at",
  "ahca_reportable",
  "ahca_reported",
  "ahca_reported_at",
  "insurance_reportable",
  "insurance_reported",
  "insurance_reported_at",
  "resolved_at",
  "resolution_notes",
  "care_plan_updated",
  "care_plan_update_notes",
  "updated_at",
].join(", ");

function formatTs(value: string | null): string {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "—";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(parsed);
}

function mapDbStatusToUi(value: string): IncidentStatusUi {
  if (value === "investigating") return "in_review";
  if (value === "resolved" || value === "closed") return "closed";
  return "open";
}

function mapDbSeverityToUi(value: string): IncidentSeverityUi {
  if (value === "level_2" || value === "level_3" || value === "level_4") return value;
  return "level_1";
}

function mapDbCategoryToUi(value: string): IncidentCategoryUi {
  if (value.startsWith("fall_")) return "fall";
  if (value === "elopement" || value === "wandering") return "elopement";
  if (value.startsWith("medication_")) return "medication_error";
  if (
    value.startsWith("behavioral_") ||
    value === "abuse_allegation" ||
    value === "neglect_allegation"
  ) {
    return "behavioral";
  }
  return "other";
}

export async function loadIncidentDetail(
  incidentId: string,
  selectedFacilityId: string | null,
  supabase: SupabaseClient<Database> = createClient(),
): Promise<IncidentDetailView | null> {
  const incResult = (await supabase
    .from("incidents" as never)
    .select(INCIDENT_COLUMNS)
    .eq("id", incidentId)
    .is("deleted_at", null)
    .maybeSingle()) as unknown as QueryResult<SupabaseIncidentDetail>;

  if (incResult.error) throw incResult.error;
  const incident = incResult.data;
  if (!incident) return null;

  if (isValidFacilityIdForQuery(selectedFacilityId) && incident.facility_id !== selectedFacilityId) {
    return null;
  }

  const [residentResult, repResult, fuResult, rcaResult, watchResult] = await Promise.all([
    incident.resident_id
      ? (supabase
          .from("residents" as never)
          .select("id, first_name, last_name")
          .eq("id", incident.resident_id)
          .is("deleted_at", null)
          .maybeSingle() as unknown as Promise<QueryResult<SupabaseResidentMini>>)
      : Promise.resolve({ data: null, error: null } as QueryResult<SupabaseResidentMini>),
    supabase
      .from("user_profiles" as never)
      .select("id, full_name")
      .eq("id", incident.reported_by)
      .maybeSingle() as unknown as Promise<QueryResult<SupabaseProfileMini>>,
    supabase
      .from("incident_followups" as never)
      .select("id, task_type, description, due_at, completed_at, assigned_to")
      .eq("incident_id", incidentId)
      .is("deleted_at", null)
      .order("due_at", { ascending: true }) as unknown as Promise<QueryListResult<SupabaseFollowup>>,
    supabase
      .from("incident_rca" as never)
      .select("investigation_status")
      .eq("incident_id", incidentId)
      .maybeSingle() as unknown as Promise<QueryResult<{ investigation_status: string }>>,
    supabase
      .from("resident_watch_instances" as never)
      .select("id, status, starts_at, ends_at, triggered_by_type, triggered_by_id, resident_watch_protocols(name)")
      .eq("triggered_by_id", incidentId)
      .is("deleted_at", null)
      .order("starts_at", { ascending: false }) as unknown as Promise<
      QueryListResult<{
        id: string;
        status: string;
        starts_at: string;
        ends_at: string | null;
        triggered_by_type: string;
        triggered_by_id: string | null;
        resident_watch_protocols?: { name: string } | null;
      }>
    >,
  ]);

  if (residentResult.error) throw residentResult.error;
  if (repResult.error) throw repResult.error;
  if (fuResult.error) throw fuResult.error;
  if (rcaResult.error) throw rcaResult.error;
  if (watchResult.error) throw watchResult.error;

  const resident = residentResult.data;
  const residentName = resident
    ? `${resident.first_name ?? ""} ${resident.last_name ?? ""}`.trim() || null
    : null;
  const reporterName = repResult.data?.full_name?.trim() || "Staff";
  const rawFollowups = fuResult.data ?? [];

  let rcaInvestigation: RcaInvestigationUi = "none";
  if (rcaResult.data) {
    rcaInvestigation = rcaResult.data.investigation_status === "complete" ? "complete" : "draft";
  }

  const watchRows = watchResult.data ?? [];
  const watchIds = watchRows.map((row) => row.id);

  const assigneeIds = [
    ...new Set(rawFollowups.map((f) => f.assigned_to).filter((id): id is string => Boolean(id))),
  ];

  const [assigneeResult, taskResult, eventResult] = await Promise.all([
    assigneeIds.length
      ? (supabase
          .from("user_profiles" as never)
          .select("id, full_name")
          .in("id", assigneeIds) as unknown as Promise<QueryListResult<SupabaseProfileMini>>)
      : Promise.resolve({ data: [], error: null } as QueryListResult<SupabaseProfileMini>),
    watchIds.length
      ? (supabase
          .from("resident_observation_tasks" as never)
          .select(
            "id, watch_instance_id, status, due_at, resident_observation_escalations(id, task_id, escalation_level, escalation_type, status, triggered_at, resolution_note, deleted_at)",
          )
          .in("watch_instance_id", watchIds)
          .is("deleted_at", null) as unknown as Promise<
          QueryListResult<SupabaseObservationTask>
        >)
      : Promise.resolve({ data: [], error: null } as QueryListResult<SupabaseObservationTask>),
    watchIds.length
      ? (supabase
          .from("resident_watch_events" as never)
          .select("id, watch_instance_id, event_type, occurred_at, note")
          .in("watch_instance_id", watchIds)
          .order("occurred_at", { ascending: false }) as unknown as Promise<
          QueryListResult<{
            id: string;
            watch_instance_id: string;
            event_type: string;
            occurred_at: string;
            note: string | null;
          }>
        >)
      : Promise.resolve({ data: [], error: null } as QueryListResult<{
          id: string;
          watch_instance_id: string;
          event_type: string;
          occurred_at: string;
          note: string | null;
        }>),
  ]);

  if (assigneeResult.error) throw assigneeResult.error;
  if (taskResult.error) throw taskResult.error;
  if (eventResult.error) throw eventResult.error;

  const assigneeById = new Map(
    (assigneeResult.data ?? []).map((p) => [p.id, p.full_name?.trim() || "Staff"]),
  );

  const followups = rawFollowups.map((f) => ({
    id: f.id,
    taskType: f.task_type,
    description: f.description,
    dueLabel: formatTs(f.due_at),
    statusLabel: f.completed_at ? "Completed" : "Open",
    assignedToId: f.assigned_to,
    assignee: f.assigned_to ? assigneeById.get(f.assigned_to) ?? "Assigned" : "",
    isCompleted: Boolean(f.completed_at),
    isOverdue: !f.completed_at && new Date(f.due_at).getTime() < Date.now(),
    hoursOverdue: !f.completed_at
      ? Math.max(0, Math.ceil((Date.now() - new Date(f.due_at).getTime()) / 3_600_000))
      : 0,
    escalationLevel: !f.completed_at
      ? classifyFollowupEscalation(
          Math.max(0, Math.ceil((Date.now() - new Date(f.due_at).getTime()) / 3_600_000)),
        )
      : ("none" as FollowupEscalationLevel),
  }));

  const taskSummaryByWatch = new Map<string, IncidentWatchInstance["taskSummary"]>();
  for (const row of taskResult.data ?? []) {
    if (!row.watch_instance_id) continue;
    const summary = taskSummaryByWatch.get(row.watch_instance_id) ?? {
      total: 0,
      open: 0,
      overdue: 0,
      missed: 0,
    };
    summary.total += 1;
    if (!["completed_on_time", "completed_late", "excused"].includes(row.status)) summary.open += 1;
    if (row.status === "overdue" || row.status === "critically_overdue") summary.overdue += 1;
    if (row.status === "missed") summary.missed += 1;
    taskSummaryByWatch.set(row.watch_instance_id, summary);
  }

  const taskById = new Map((taskResult.data ?? []).map((row) => [row.id, row] as const));
  const assuranceEscalationRows = (taskResult.data ?? [])
    .flatMap((row) => row.resident_observation_escalations ?? [])
    .filter(
      (row) =>
        row.deleted_at == null &&
        (row.status === "open" || row.status === "in_progress"),
    )
    .sort((a, b) => b.triggered_at.localeCompare(a.triggered_at));

  const eventsByWatch = new Map<string, IncidentWatchInstance["events"]>();
  for (const row of eventResult.data ?? []) {
    const list = eventsByWatch.get(row.watch_instance_id) ?? [];
    list.push({
      id: row.id,
      event_type: row.event_type,
      occurred_at: row.occurred_at,
      note: row.note,
    });
    eventsByWatch.set(row.watch_instance_id, list);
  }

  return {
    incident,
    residentName,
    reporterName,
    categoryUi: mapDbCategoryToUi(incident.category),
    severityUi: mapDbSeverityToUi(incident.severity),
    statusUi: mapDbStatusToUi(incident.status),
    rcaInvestigation,
    followups,
    watchInstances: watchRows.map((row) => ({
      id: row.id,
      status: row.status,
      starts_at: row.starts_at,
      ends_at: row.ends_at,
      triggered_by_type: row.triggered_by_type,
      triggered_by_id: row.triggered_by_id,
      resident_watch_protocols: row.resident_watch_protocols ?? null,
      taskSummary: taskSummaryByWatch.get(row.id) ?? { total: 0, open: 0, overdue: 0, missed: 0 },
      events: eventsByWatch.get(row.id) ?? [],
    })),
    assuranceEscalations: assuranceEscalationRows.map((row) => ({
      id: row.id,
      task_id: row.task_id,
      escalation_level: row.escalation_level,
      escalation_type: row.escalation_type,
      status: row.status,
      triggered_at: row.triggered_at,
      resolution_note: row.resolution_note,
      task_status: taskById.get(row.task_id)?.status ?? "unknown",
      task_due_at: taskById.get(row.task_id)?.due_at ?? row.triggered_at,
    })),
  };
}
