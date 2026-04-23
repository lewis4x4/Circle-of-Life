import type { SupabaseClient } from "@supabase/supabase-js";

import { classifyFollowupEscalation, isFollowupEscalated } from "@/lib/incidents/followup-escalation";
import { buildIncidentOpenObligations } from "@/lib/incidents/workflow-obligations";
import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import type { Database } from "@/types/database";

export type IncidentSeverity = "level_1" | "level_2" | "level_3" | "level_4";
export type IncidentStatus = "new" | "investigating" | "regulatory_review" | "closed";
export type IncidentCategory = "fall" | "medication_error" | "behavioral" | "elopement" | "other";

export type IncidentRow = {
  id: string;
  incidentNumber: string;
  residentName: string;
  category: IncidentCategory;
  severity: IncidentSeverity;
  status: IncidentStatus;
  reportedAt: string;
  reportedBy: string;
  followupDueStr: string;
  followupDueMs: number;
  openFollowups: number;
  overdueFollowups: number;
  unassignedFollowups: number;
  escalatedFollowups: number;
  criticalFollowups: number;
  openObligations: number;
  rootCausePending: boolean;
  carePlanPending: boolean;
  ahcaReportable: boolean;
  ahcaReported: boolean;
};

type SupabaseIncidentRow = {
  id: string;
  incident_number: string;
  resident_id: string | null;
  facility_id: string;
  category: string;
  severity: string;
  status: string;
  occurred_at: string;
  reported_by: string;
  nurse_notified: boolean;
  administrator_notified: boolean;
  owner_notified: boolean;
  physician_notified: boolean;
  family_notified: boolean;
  ahca_reportable: boolean;
  ahca_reported: boolean;
  insurance_reportable: boolean;
  insurance_reported: boolean;
  care_plan_updated: boolean;
  resolved_at: string | null;
  deleted_at: string | null;
};

type SupabaseFollowupMini = {
  incident_id: string;
  due_at: string;
  assigned_to: string | null;
  completed_at: string | null;
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

export async function fetchIncidentsFromSupabase(
  selectedFacilityId: string | null,
  supabase: SupabaseClient<Database> = createClient(),
): Promise<IncidentRow[]> {
  let incidentsQuery = supabase
    .from("incidents" as never)
    .select(
      "id, incident_number, resident_id, facility_id, category, severity, status, occurred_at, reported_by, nurse_notified, administrator_notified, owner_notified, physician_notified, family_notified, ahca_reportable, ahca_reported, insurance_reportable, insurance_reported, care_plan_updated, resolved_at, deleted_at"
    )
    .is("deleted_at", null)
    .order("occurred_at", { ascending: false })
    .limit(200);

  if (isValidFacilityIdForQuery(selectedFacilityId)) {
    incidentsQuery = incidentsQuery.eq("facility_id", selectedFacilityId);
  }

  const incidentsResult = await incidentsQuery;
  const incidents = (incidentsResult.data as SupabaseIncidentRow[]) ?? [];
  if (incidents.length === 0) return [];

  const incidentIds = incidents.map((row) => row.id);
  const residentIds = Array.from(new Set(incidents.map((row) => row.resident_id).filter(Boolean))) as string[];
  const reporterIds = Array.from(new Set(incidents.map((row) => row.reported_by)));

  // None of these four secondary fetches depend on each other — run them in
  // parallel instead of chaining four serial round-trips after the primary
  // incidents query. Saves ~3 RTTs on every load.
  const [residentsResult, profilesResult, followupsResult, rcaResult] = await Promise.all([
    residentIds.length
      ? supabase.from("residents" as never).select("id, first_name, last_name").in("id", residentIds)
      : Promise.resolve({ data: [] }),
    reporterIds.length
      ? supabase.from("user_profiles" as never).select("id, full_name").in("id", reporterIds)
      : Promise.resolve({ data: [] }),
    incidentIds.length
      ? supabase
          .from("incident_followups" as never)
          .select("incident_id, due_at, assigned_to, completed_at")
          .in("incident_id", incidentIds)
          .is("completed_at", null)
      : Promise.resolve({ data: [] }),
    incidentIds.length
      ? supabase
          .from("incident_rca" as never)
          .select("incident_id, investigation_status")
          .in("incident_id", incidentIds)
      : Promise.resolve({ data: [] }),
  ]);

  const residentById = new Map(
    ((residentsResult.data ?? []) as SupabaseResidentMini[]).map((r) => [r.id, r] as const)
  );
  const reporterById = new Map(
    ((profilesResult.data ?? []) as SupabaseProfileMini[]).map((p) => [p.id, p] as const)
  );
  const rcaByIncidentId = new Map(
    (((rcaResult.data ?? []) as Array<{ incident_id: string; investigation_status: string }>)).map((row) => [row.incident_id, row.investigation_status] as const),
  );

  const nextDueByIncident = new Map<string, number>();
  const openFollowupsByIncident = new Map<string, number>();
  const overdueFollowupsByIncident = new Map<string, number>();
  const unassignedFollowupsByIncident = new Map<string, number>();
  const escalatedFollowupsByIncident = new Map<string, number>();
  const criticalFollowupsByIncident = new Map<string, number>();
  for (const row of (followupsResult.data as SupabaseFollowupMini[] ?? [])) {
    const epoch = new Date(row.due_at).getTime();
    const existing = nextDueByIncident.get(row.incident_id);
    if (!existing || epoch < existing) {
      nextDueByIncident.set(row.incident_id, epoch);
    }
    openFollowupsByIncident.set(row.incident_id, (openFollowupsByIncident.get(row.incident_id) ?? 0) + 1);
    if (epoch < Date.now()) {
      overdueFollowupsByIncident.set(row.incident_id, (overdueFollowupsByIncident.get(row.incident_id) ?? 0) + 1);
      const hoursOverdue = Math.max(1, Math.ceil((Date.now() - epoch) / 3_600_000));
      const escalationLevel = classifyFollowupEscalation(hoursOverdue);
      if (isFollowupEscalated(escalationLevel)) {
        escalatedFollowupsByIncident.set(row.incident_id, (escalatedFollowupsByIncident.get(row.incident_id) ?? 0) + 1);
      }
      if (escalationLevel === "critical") {
        criticalFollowupsByIncident.set(row.incident_id, (criticalFollowupsByIncident.get(row.incident_id) ?? 0) + 1);
      }
    }
    if (!row.assigned_to) {
      unassignedFollowupsByIncident.set(row.incident_id, (unassignedFollowupsByIncident.get(row.incident_id) ?? 0) + 1);
    }
  }

  return incidents.map((row) => {
    const resident = row.resident_id ? residentById.get(row.resident_id) : null;
    const residentName = resident ? `${resident.first_name ?? ""} ${resident.last_name ?? ""}`.trim() : "Unknown resident";
    const reporter = reporterById.get(row.reported_by);
    const reportedBy = reporter?.full_name?.trim() || "Staff";
    const openFollowups = openFollowupsByIncident.get(row.id) ?? 0;
    const overdueFollowups = overdueFollowupsByIncident.get(row.id) ?? 0;
    const unassignedFollowups = unassignedFollowupsByIncident.get(row.id) ?? 0;
    const escalatedFollowups = escalatedFollowupsByIncident.get(row.id) ?? 0;
    const criticalFollowups = criticalFollowupsByIncident.get(row.id) ?? 0;
    const openObligations = buildIncidentOpenObligations(row).length;
    const rcaStatus = rcaByIncidentId.get(row.id);
    const rootCausePending =
      row.severity === "level_3" ||
      row.severity === "level_4" ||
      followupsResult.data?.some?.((item: SupabaseFollowupMini) => item.incident_id === row.id) === true
        ? rcaStatus !== "complete"
        : false;
    const carePlanPending =
      Boolean(row.resolved_at) &&
      !row.care_plan_updated &&
      (row.severity === "level_3" || row.severity === "level_4" || openFollowups > 0);

    let status: IncidentStatus = "new";
    if (row.status === "resolved" || row.status === "closed") {
      status = "closed";
    } else if (row.status === "in_review" || row.status === "regulatory_review" || (row.ahca_reportable && !row.ahca_reported)) {
      status = "regulatory_review";
    } else if (row.status === "investigating" || openFollowups > 0) {
      status = "investigating";
    }

    const dueMs = nextDueByIncident.get(row.id) || 0;

    return {
      id: row.id,
      incidentNumber: row.incident_number,
      residentName,
      category: mapDbCategoryToUi(row.category),
      severity: mapDbSeverityToUi(row.severity),
      status,
      reportedAt: formatOccurredAt(row.occurred_at),
      reportedBy,
      followupDueStr: dueMs ? formatFollowupDue(new Date(dueMs).toISOString()) : "—",
      followupDueMs: dueMs,
      openFollowups,
      overdueFollowups,
      unassignedFollowups,
      escalatedFollowups,
      criticalFollowups,
      openObligations,
      rootCausePending,
      carePlanPending,
      ahcaReportable: row.ahca_reportable,
      ahcaReported: row.ahca_reported,
    } as IncidentRow;
  });
}

function mapDbSeverityToUi(value: string): IncidentSeverity {
  if (value === "level_2" || value === "level_3" || value === "level_4") return value;
  return "level_1";
}

function mapDbCategoryToUi(value: string): IncidentCategory {
  if (value.startsWith("fall_")) return "fall";
  if (value === "elopement" || value === "wandering") return "elopement";
  if (value.startsWith("medication_")) return "medication_error";
  if (value.startsWith("behavioral_") || value === "abuse_allegation" || value === "neglect_allegation") return "behavioral";
  return "other";
}

function formatOccurredAt(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Unknown";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(parsed);
}

function formatFollowupDue(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return "—";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(parsed);
}
